import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadChunks } from "./corpus";
import { DEMO_TODAY, INDEX_PATH, PROJECT_ROOT, DEFAULT_EMBEDDING_MODEL, loadSettings, positiveInteger, requireKey, requireChatModel } from "./config";
import { buildIndex, readIndex, saveJson } from "./index-store";
import { CallBudget, createChatModel, OpenRouterEmbedder } from "./provider";
import { loadOrders, scopeForOrder, visibleOrders } from "./orders";
import { retrieve } from "./retrieval";
import { CASES, type Case } from "./evaluation";
import { runConsultation } from "./runner";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || flags[key.slice(2)] !== undefined) throw new Error("Use unique --flag value pairs.");
    flags[key.slice(2)] = value;
  }
  return flags;
}

export function safeError(error: unknown, key?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (key) message = message.split(key).join("[REDACTED]");
  return message.replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED]");
}

async function main() {
  const command = process.argv[2] ?? "inspect";
  const flags = parseFlags(process.argv.slice(3));
  const allowed: Record<string, string[]> = {
    inspect: [], index: [], retrieve: ["query", "order", "top-k"],
    ask: ["mode", "case", "question", "order", "top-k"], evaluate: ["mode", "limit", "top-k"],
  };
  if (!allowed[command] || Object.keys(flags).some(flag => !allowed[command]!.includes(flag))) throw new Error("Unknown command or flag. See README.md.");
  const settings = await loadSettings();
  const embeddingModel = settings.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const chunks = await loadChunks();
  const orders = await loadOrders();
  if (command === "inspect") {
    let indexStatus = "";
    try { const index = await readIndex(chunks, embeddingModel); indexStatus = `valid: ${index.entries.length} vectors, dimension ${index.dimension}`; }
    catch (error) { indexStatus = safeError(error); }
    console.log(JSON.stringify({ businessDate: DEMO_TODAY, data: "synthetic fixtures, not a real refund service",
      apiKeyConfigured: Boolean(settings.OPENROUTER_API_KEY), chatModel: settings.OPENROUTER_MODEL ?? settings.MODEL_NAME ?? null,
      embeddingModel, indexStatus, cases: CASES.map(({ id, question }) => ({ id, question })),
      chunks: chunks.map(chunk => ({ id: chunk.id, category: chunk.category, channel: chunk.channel,
        effectiveFrom: chunk.effectiveFrom, effectiveUntil: chunk.effectiveUntil, characters: chunk.text.length, section: chunk.section })),
    }, null, 2));
    return;
  }
  const key = requireKey(settings);
  const budget = new CallBudget(positiveInteger(settings.MAX_API_CALLS, 40, 100));
  const embedder = new OpenRouterEmbedder(embeddingModel, key, budget);
  const topK = positiveInteger(flags["top-k"], 3, 10);
  const runPath = resolve(PROJECT_ROOT, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${command}-${randomUUID().slice(0, 8)}.json`);
  const artifact: Record<string, unknown> = { command, flags, businessDate: DEMO_TODAY, embeddingModel, startedAt: new Date().toISOString() };
  const caseRuns: unknown[] = [];
  let activeChat: ReturnType<typeof createChatModel> | undefined;
  try {
    if (command === "index") {
      const result = await buildIndex(chunks, embedder);
      artifact.index = { path: INDEX_PATH, cacheHit: result.cacheHit, chunks: result.index.entries.length, dimension: result.index.dimension, fingerprint: result.index.fingerprint };
      console.log(JSON.stringify(artifact.index, null, 2));
    } else {
      const index = await readIndex(chunks, embeddingModel);
      artifact.indexFingerprint = index.fingerprint;
      if (command === "retrieve") {
        if (!flags.query || !flags.order) throw new Error("retrieve needs --query and --order.");
        const order = visibleOrders(orders, "demo-user", flags.order)[0];
        if (!order) throw new Error("Order not found for the current fixture user.");
        const search = await retrieve(flags.query, scopeForOrder(order), index, embedder, topK);
        artifact.search = search;
        console.log(JSON.stringify(search, null, 2));
      } else {
        const mode = flags.mode ?? "agent";
        if (mode !== "rag" && mode !== "agent") throw new Error("mode must be rag or agent.");
        if (flags.case && (flags.question || flags.order)) throw new Error("Use --case OR --question with optional --order.");
        const modelName = requireChatModel(settings);
        artifact.chatModel = modelName;
        const maxOutputTokens = positiveInteger(settings.MAX_OUTPUT_TOKENS, 1500, 8000);
        let cases: Array<{ question: string; orderId?: string; expected?: Case }>;
        if (command === "evaluate") {
          cases = CASES.slice(0, positiveInteger(flags.limit, CASES.length, CASES.length)).map(c => ({ question: c.question, ...(c.orderId ? { orderId: c.orderId } : {}), expected: c }));
        } else if (flags.question) {
          cases = [{ question: flags.question, ...(flags.order ? { orderId: flags.order } : {}) }];
        } else {
          const selected = CASES.find(c => c.id === (flags.case ?? "normal"));
          if (!selected) throw new Error(`Unknown case; choose ${CASES.map(c => c.id).join(", ")}.`);
          cases = [{ question: selected.question, ...(selected.orderId ? { orderId: selected.orderId } : {}), expected: selected }];
        }
        for (const item of cases) {
          console.log(`Running ${item.expected?.id ?? "custom"} (${mode}); API calls used ${budget.used}/${budget.limit}`);
          activeChat = createChatModel(key, modelName, budget, maxOutputTokens);
          const beforeCalls = budget.used;
          const result = await runConsultation({ ...item, mode, today: DEMO_TODAY, userId: "demo-user", orders, index, embedder, model: activeChat, topK });
          caseRuns.push({ caseId: item.expected?.id ?? "custom", ...result, apiCalls: budget.used - beforeCalls,
            requests: activeChat.transportRequests, exchanges: activeChat.exchanges });
          activeChat = undefined;
          console.log(result.rawAnswer || "No final answer.");
          console.log(JSON.stringify(result.evaluation, null, 2));
          if (!result.evaluation.automatedPassed) process.exitCode = 1;
          if (budget.used >= budget.limit) break;
        }
        artifact.plannedCases = cases.length;
        artifact.completedCases = caseRuns.length;
        if (caseRuns.length !== cases.length) { artifact.incomplete = true; process.exitCode = 1; }
        console.log("自动检查不等于语义正确；请人工核对引用是否真正支持回答。");
      }
    }
  } catch (error) {
    artifact.error = safeError(error, key);
    if (activeChat) artifact.failedExchange = { requests: activeChat.transportRequests, exchanges: activeChat.exchanges };
    process.exitCode = 1;
    console.error(artifact.error);
  } finally {
    artifact.cases = caseRuns;
    artifact.apiCalls = { used: budget.used, limit: budget.limit };
    artifact.embeddingExchanges = embedder.exchanges;
    artifact.finishedAt = new Date().toISOString();
    // Defensive redaction before persistence, even if a provider echoes a credential in an error.
    const redacted = JSON.parse(JSON.stringify(artifact).split(key).join("[REDACTED]"));
    await saveJson(runPath, redacted);
    console.log(`Trace: ${runPath}`);
  }
}

main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
