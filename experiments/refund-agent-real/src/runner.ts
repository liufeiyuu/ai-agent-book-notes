import { runAgent } from "../../minimal-agent-ts/src/agent";
import { ToolRegistry } from "../../minimal-agent-ts/src/tool-registry";
import type { Model } from "../../minimal-agent-ts/src/types";
import { buildContext, SYSTEM_PROMPT } from "./context";
import { evaluateAnswer, type Case } from "./evaluation";
import { visibleOrders, scopeForOrder } from "./orders";
import { exclusionReason, retrieve } from "./retrieval";
import { createTools } from "./tools";
import type { Embedder, IndexArtifact, Order, SearchHit, SearchTrace } from "./types";

export interface RunOptions {
  mode: "rag" | "agent";
  question: string;
  orderId?: string;
  today: string;
  userId: string;
  orders: Order[];
  index: IndexArtifact;
  embedder: Embedder;
  model: Model;
  topK: number;
  expected?: Case; // Evaluation only: never pass this field to buildContext or runAgent.
}

// 学习入口 1：先读固定 RAG 分支，找到检索结果真正进入模型请求的那一行。
export async function runConsultation(options: RunOptions) {
  const started = Date.now();
  const searches: SearchTrace[] = [];
  let hits: SearchHit[] = [];
  let knownOrderIds: string[] = [];
  let rawAnswer = "";
  let completed = false;
  let execution: unknown;
  if (options.mode === "rag") {
    // Fixed RAG requires a caller-selected order; ambiguous input passes all candidates for clarification.
    const orders = visibleOrders(options.orders, options.userId, options.orderId);
    knownOrderIds = orders.map(order => order.id);
    if (orders.length === 1) {
      const search = await retrieve(options.question, scopeForOrder(orders[0]!), options.index, options.embedder, options.topK);
      searches.push(search);
      hits = search.hits;
    }
    const messages = buildContext(options.question, orders, hits, options.today);
    const response = await options.model.generate({ messages, tools: [], signal: AbortSignal.timeout(90_000) });
    rawAnswer = response.message.content ?? "";
    completed = response.message.toolCalls.length === 0 && response.finishReason !== "length" && rawAnswer.trim().length > 0;
    execution = { messages, response, completed };
  } else {
    const state = createTools(options);
    const result = await runAgent({
      model: options.model, registry: new ToolRegistry(state.tools), systemPrompt: SYSTEM_PROMPT,
      userInput: JSON.stringify({ task: options.question, businessDate: options.today,
        ...(options.orderId ? { selectedOrderId: options.orderId } : {}) }),
      maxTurns: 6, timeoutMs: 150_000,
    });
    execution = result;
    rawAnswer = result.finalAnswer ?? "";
    completed = result.completed;
    knownOrderIds = [...state.queriedOrders.keys()];
    searches.push(...state.searches);
    hits = searches.flatMap(search => search.hits);
  }
  const evaluation = evaluateAnswer(rawAnswer, hits, knownOrderIds, options.expected);
  if (evaluation.answer?.status === "eligible" || evaluation.answer?.status === "ineligible") {
    const order = visibleOrders(options.orders, options.userId, evaluation.answer.orderIds[0])[0];
    evaluation.checks.push({ name: "cited_policy_applies_to_order", passed: Boolean(order) && evaluation.answer.citations.every(citation => {
      const hit = hits.find(item => item.chunk.id === citation.chunkId);
      return Boolean(hit && order && exclusionReason(hit.chunk, scopeForOrder(order)) === null);
    }) });
  }
  evaluation.checks.push({ name: "execution_completed", passed: completed });
  if (options.mode === "agent") {
    evaluation.checks.push({ name: "orders_actually_queried", passed: knownOrderIds.length > 0 });
    if (evaluation.answer?.status !== "needs_clarification") {
      evaluation.checks.push({ name: "policy_search_attempted", passed: searches.length > 0 });
    }
  }
  evaluation.automatedPassed = evaluation.checks.every(check => check.passed);
  return { mode: options.mode, question: options.question, businessDate: options.today,
    elapsedMs: Date.now() - started, rawAnswer, knownOrderIds, searches, execution, evaluation };
}
