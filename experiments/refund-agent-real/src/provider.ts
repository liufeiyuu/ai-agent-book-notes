import { OpenRouterModel } from "../../minimal-agent-ts/src/openrouter-model";
import { record, type Embedder } from "./types";
import { ANSWER_SCHEMA } from "./answer";

type FetchLike = typeof fetch;

export class CallBudget {
  used = 0;
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid API call budget.");
  }
  take(): void {
    if (this.used >= this.limit) throw new Error("API call budget exhausted; no automatic retry.");
    this.used++;
  }
}

export function validateVector(value: unknown, dimension?: number): asserts value is number[] {
  if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== "number" || !Number.isFinite(x)) ||
      (dimension !== undefined && value.length !== dimension) || value.every(x => x === 0)) {
    throw new Error("Invalid embedding: expected a finite, non-zero vector with consistent dimensions.");
  }
}

// 学习入口 2：真正向 Embedding API 发送文本；按 response.index 关联向量与原文。
export class OpenRouterEmbedder implements Embedder {
  readonly exchanges: Array<{ model: string; inputs: number; dimension: number; usage: unknown; elapsedMs: number }> = [];
  constructor(readonly model: string, private readonly apiKey: string, private readonly budget: CallBudget,
    private readonly fetch_: FetchLike = fetch) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; usage: unknown }> {
    if (!texts.length || texts.some(x => !x.trim() || x.length > 8000)) throw new Error("Embedding input is empty or too large.");
    signal?.throwIfAborted();
    this.budget.take();
    const started = Date.now();
    const response = await this.fetch_("https://openrouter.ai/api/v1/embeddings", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts, encoding_format: "float" }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      // Preserve a useful provider diagnosis without logging headers, credentials or arbitrary HTML.
      let detail = "No structured error detail; check model access, balance and configuration.";
      try {
        const failure: unknown = await response.json();
        const error = record(failure) && record(failure.error) ? failure.error : failure;
        if (record(error) && typeof error.message === "string") detail = error.message;
      } catch { /* Some gateways return HTML rather than a JSON API error. */ }
      const redacted = detail.split(this.apiKey).join("[REDACTED]")
        .replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 1000);
      throw new Error(`Embedding API returned HTTP ${response.status}: ${redacted}`);
    }
    const body: unknown = await response.json();
    if (!record(body) || !Array.isArray(body.data) || body.data.length !== texts.length) throw new Error("Embedding response count mismatch.");
    const vectors = new Array<number[]>(texts.length);
    let dimension: number | undefined;
    for (const item of body.data) {
      if (!record(item) || !Number.isInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= texts.length) throw new Error("Invalid embedding response index.");
      if (vectors[item.index as number] !== undefined) throw new Error("Duplicate embedding response index.");
      validateVector(item.embedding, dimension);
      dimension = item.embedding.length;
      vectors[item.index as number] = item.embedding;
    }
    const usage = body.usage ?? null;
    this.exchanges.push({ model: this.model, inputs: texts.length, dimension: dimension!, usage, elapsedMs: Date.now() - started });
    return { vectors, usage };
  }
}

export function chatParameters(model: string, maxOutputTokens: number, requiresTool = false) {
  return { max_tokens: maxOutputTokens, temperature: 0,
    // Tool stages request arguments, not a final-answer object. Restore strict JSON for answers.
    ...(requiresTool ? {} : { response_format: { type: "json_schema", json_schema: { name: "refund_consultation", strict: true, schema: ANSWER_SCHEMA } } }),
    provider: { require_parameters: true },
    // Week-one messages do not round-trip reasoning blocks. Use V4's supported non-thinking mode.
    // This also leaves the small output budget available for a final answer/tool arguments.
    ...(model.startsWith("deepseek/deepseek-v4-") ? { reasoning: { enabled: false } } : {}),
  };
}

// Reuse week-one request conversion and response parsing. Limit each paid request here.
export function createChatModel(apiKey: string, model: string, budget: CallBudget, maxOutputTokens: number, fetch_: FetchLike = fetch) {
  const transportRequests: Record<string, unknown>[] = [];
  const adapter = new OpenRouterModel({
    apiKey, model, appTitle: "refund-agent-real-learning",
    fetch: async (url, init) => {
      init?.signal?.throwIfAborted();
      budget.take();
      const body: Record<string, unknown> = JSON.parse(String(init?.body));
      Object.assign(body, chatParameters(model, maxOutputTokens, body.tool_choice === "required"));
      transportRequests.push(structuredClone(body)); // Exact sent payload, never authorization headers.
      return fetch_(url, { ...init, body: JSON.stringify(body),
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    },
  });
  return Object.assign(adapter, { transportRequests });
}
