import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenRouterModel } from "../../minimal-agent-ts/src/openrouter-model";
import { CANDIDATE_SCHEMA } from "./memory";

// 用户批准增加一次助手复验；保留原有调用记录及学习者的四次名额。
export const MAX_ATTEMPTS = 9;
export async function attemptsUsed(directory: string): Promise<number> {
  try { return (await readdir(directory)).filter(name => /^[1-9]\d*\.json$/.test(name)).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

// 每次网络尝试前占一个持久化名额。wx 防止两个进程占到同一名额，没有自动重置入口。
export async function reserveAttempt(directory: string, metadata: Record<string, unknown>): Promise<number> {
  await mkdir(directory, { recursive: true });
  for (let number = 1; number <= MAX_ATTEMPTS; number++) {
    try {
      await writeFile(resolve(directory, `${number}.json`), JSON.stringify({ ...metadata, number, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      return number;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  throw new Error(`This lesson has exhausted its ${MAX_ATTEMPTS} persistent API attempts. Do not reset or raise the limit without approval.`);
}

export function redact(text: string, key = ""): string {
  return (key ? text.split(key).join("[REDACTED]") : text).replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

// 基础设施：复用第一周适配器，记录最终传输的请求，但从不记录 Authorization。
export function createMemoryModel(options: {
  apiKey: string; model: string; kind: "remember" | "ask"; userId: string;
  budgetDirectory: string; fetch?: typeof fetch;
}) {
  const requests: Record<string, unknown>[] = [];
  const responses: Array<{ status: number; body: unknown }> = [];
  const attempts: number[] = [];
  const model = new OpenRouterModel({
    apiKey: options.apiKey, model: options.model, appTitle: "user-memory-minimal-learning",
    fetch: async (url, init) => {
      init?.signal?.throwIfAborted();
      const body: Record<string, unknown> = JSON.parse(String(init?.body));
      Object.assign(body, {
        temperature: 0, max_tokens: options.kind === "remember" ? 300 : 900,
        ...(options.model.startsWith("deepseek/deepseek-v4-") ? { reasoning: { enabled: false } } : {}),
        ...(options.kind === "remember" ? {
          response_format: { type: "json_schema", json_schema: { name: "memory_candidate", strict: true, schema: CANDIDATE_SCHEMA } },
          provider: { require_parameters: true },
        } : {}),
      });
      attempts.push(await reserveAttempt(options.budgetDirectory, { model: options.model, kind: options.kind, userId: options.userId, pid: process.pid }));
      requests.push(structuredClone(body));
      const response = await (options.fetch ?? fetch)(url, {
        ...init, body: JSON.stringify(body),
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
      const text = await response.clone().text();
      let responseBody: unknown;
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
      responses.push({ status: response.status, body: responseBody });
      return response;
    },
  });
  return { model, requests, responses, attempts };
}
