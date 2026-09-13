import { runAgent } from "../../minimal-agent-ts/src/agent";
import { ToolRegistry } from "../../minimal-agent-ts/src/tool-registry";
import type { Model } from "../../minimal-agent-ts/src/types";
import { buildContext, SYSTEM_PROMPT } from "./context";
import { evaluateAnswer, type Case } from "./evaluation";
import { parseAnswer } from "./answer";
import { visibleOrders, scopeForOrder } from "./orders";
import { exclusionReason, retrieve } from "./retrieval";
import { createTools } from "./tools";
import { createWorkflow } from "./workflow";
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
  let orderQueryCount = 0;
  let workflow: ReturnType<typeof createWorkflow> | undefined;
  let toolState: ReturnType<typeof createTools> | undefined;
  let execution: unknown;
  if (options.mode === "rag") {
    // Fixed RAG requires a caller-selected order; ambiguous input passes all candidates for clarification.
    const orders = visibleOrders(options.orders, options.userId, options.orderId);
    knownOrderIds = orders.map(order => order.id);
    try {
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
    } catch (error) {
      // Retain successful retrieval and its full ranking even when generation fails.
      execution = { completed: false, error: error instanceof Error ? error.message : String(error) };
    }
  } else {
    const state = createTools(options);
    toolState = state;
    workflow = createWorkflow(state, options.orderId);
    const result = await runAgent({
      model: options.model, registry: new ToolRegistry(state.tools), systemPrompt: SYSTEM_PROMPT,
      // 这里构造模型收到的用户输入。
      userInput: JSON.stringify({ task: options.question, businessDate: options.today,
        ...(options.orderId ? { selectedOrderId: options.orderId } : {}) }),
      maxTurns: 6, timeoutMs: 150_000,
      prepareRequest: workflow.prepareRequest,
      validateFinal: response => workflow!.validateFinal(response.message.content ?? ""),
    });
    execution = result;
    // result 是刚才 runAgent(...) 返回的运行结果。
    // 这行把其中的最终答案取出来，放进 rawAnswer。如果没有最终答案，就用空字符串。
    // 此时，rawAnswer 仍然是一段字符串，里面写着 JSON 格式的退款判断。
    rawAnswer = result.finalAnswer ?? "";
    completed = result.completed;
    knownOrderIds = [...state.queriedOrders.keys()];
    orderQueryCount = state.orderQueries.length;
    searches.push(...state.searches);
    hits = searches.flatMap(search => search.hits);
  }
  // Some providers do not enforce response_format while tools are enabled.
  // One bounded, tool-free regeneration from observed facts; retain the failed draft.
  let formatRecovery: unknown = null;
  if (completed) {
    let valid = true;
    try { parseAnswer(rawAnswer); } catch { valid = false; }
    if (!valid) {
      const initialAnswer = rawAnswer;
      const observedOrders = visibleOrders(options.orders, options.userId).filter(order => knownOrderIds.includes(order.id));
      const messages = buildContext(options.question, observedOrders, hits, options.today);
      try {
        const response = await options.model.generate({ messages, tools: [], signal: AbortSignal.timeout(60_000) });
        rawAnswer = response.message.content ?? "";
        completed = response.message.toolCalls.length === 0 && response.finishReason !== "length" && rawAnswer.trim().length > 0;
        formatRecovery = { attempted: true, initialAnswer, messages, response };
      } catch (error) {
        rawAnswer = "";
        completed = false;
        formatRecovery = { attempted: true, initialAnswer, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  // Recovery may change the JSON answer, but it cannot bypass business prerequisites.
  const workflowError = workflow?.validateFinal(rawAnswer);
  if (workflowError) completed = false;
  // 这里拿答案、实际检索证据、已知订单等进行检查；后面还会补充流程检查。
  // 评测函数是在生成检查报告，不是在替模型重新决定能不能退。
  // 模型回答之后，评测才使用参考答案，最后一个参数 options.expected，才是给评测函数使用的案例参考信息。
  // 给模型问题和可用工具 → 模型取得事实、生成答案 → 程序拿参考答案检查它。
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
    evaluation.checks.push({ name: "orders_actually_queried", passed: orderQueryCount > 0 });
    evaluation.checks.push({ name: "workflow_complete", passed: workflowError === undefined });
    const target = workflow!.progress().targetOrderId;
    if (target) {
      evaluation.checks.push({ name: "policy_search_attempted", passed: toolState!.policyOrderIds.has(target) });
    }
  }
  evaluation.automatedPassed = evaluation.checks.every(check => check.passed);
  return { mode: options.mode, question: options.question, businessDate: options.today,
    elapsedMs: Date.now() - started, rawAnswer, knownOrderIds, searches, execution, formatRecovery,
    workflow: workflow ? { ...workflow.progress(), orderQueries: toolState!.orderQueries,
      policyOrderIds: [...toolState!.policyOrderIds], error: workflowError ?? null } : null, evaluation };
}
