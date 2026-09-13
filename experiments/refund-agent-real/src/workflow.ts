import type { ModelInput } from "../../minimal-agent-ts/src/types";
import { parseAnswer } from "./answer";
import type { createTools } from "./tools";

type ToolState = ReturnType<typeof createTools>;
type Progress = {
  stage: "query_orders" | "search_policy" | "answer" | "clarify";
  targetOrderId?: string;
  candidateOrderIds: string[];
};

// Business completion is separate from the model's stop signal and from gold-label evaluation.
export function createWorkflow(state: ToolState, selectedOrderId?: string) {
  const selected = selectedOrderId?.trim().toLowerCase();

  function progress(): Progress {
    let candidates: string[];
    if (selected) {
      const observed = [...state.queriedOrders.keys()].find(id => id.toLowerCase() === selected);
      if (observed) candidates = [observed];
      else {
        const checkedMissing = state.orderQueries.some(query =>
          query.order_id?.toLowerCase() === selected && !query.keyword && query.returnedOrderIds.length === 0);
        return { stage: checkedMissing ? "clarify" : "query_orders", candidateOrderIds: [] };
      }
    } else {
      if (state.orderQueries.length === 0) return { stage: "query_orders", candidateOrderIds: [] };
      // Keep the first nonempty candidate set. A later arbitrary exact lookup cannot
      // turn an ambiguous request into user confirmation; --order supplies that choice.
      candidates = state.orderQueries.find(query => query.returnedOrderIds.length > 0)?.returnedOrderIds ?? [];
    }
    if (candidates.length !== 1) return { stage: "clarify", candidateOrderIds: [...candidates] };
    const targetOrderId = candidates[0]!;
    return { stage: state.policyOrderIds.has(targetOrderId) ? "answer" : "search_policy",
      targetOrderId, candidateOrderIds: [targetOrderId] };
  }

  function prerequisiteError(): string | undefined {
    const current = progress();
    if (current.stage === "query_orders") return `流程未完成：必须先成功调用 query_orders${selectedOrderId ? ` 查询用户指定的 ${selectedOrderId}` : " 获取当前用户订单"}。不能把用户提到的订单号当作已查询的订单事实。`;
    if (current.stage === "search_policy") return `流程未完成：已经查到 ${current.targetOrderId} 的订单事实，必须成功调用 search_policy 查询该订单的适用政策。空检索结果也是有效结果；工具报错不是空结果。`;
    return undefined;
  }

  function prepareRequest(input: ModelInput): ModelInput {
    const current = progress();
    if (current.stage === "answer" || current.stage === "clarify") return input;
    const tool = input.tools.find(item => item.name === current.stage);
    if (!tool) throw new Error(`Required workflow tool is unavailable: ${current.stage}`);
    const definition = structuredClone(tool);
    const orderId = current.stage === "query_orders" ? selectedOrderId : current.targetOrderId;
    if (orderId) {
      definition.inputSchema = current.stage === "query_orders"
        ? { type: "object", properties: { order_id: { type: "string", enum: [orderId] } }, required: ["order_id"], additionalProperties: false }
        : { ...definition.inputSchema, properties: {
          order_id: { type: "string", enum: [orderId] }, query: { type: "string" },
        } };
    }
    return { ...input, tools: [definition], toolChoice: "required",
      messages: [...input.messages, { role: "system", content: prerequisiteError()! }] };
  }

  function validateFinal(raw: string): string | undefined {
    const missing = prerequisiteError();
    if (missing) return missing;
    let answer;
    try { answer = parseAnswer(raw); } catch { return undefined; } // Formatting alone may use bounded recovery.
    const current = progress();
    if (answer.orderIds.some(id => !state.queriedOrders.has(id))) return "回答包含未成功查询的订单号；只能使用工具已返回的订单。";
    if (current.targetOrderId && (answer.orderIds.length !== 1 || answer.orderIds[0] !== current.targetOrderId)) {
      return `回答必须针对已确认的目标订单 ${current.targetOrderId}，不能换成其他订单。`;
    }
    if (current.stage === "clarify") {
      if (current.candidateOrderIds.length > 1 && answer.status !== "needs_clarification") {
        return "订单有多个候选，必须 needs_clarification 并让用户选择，不能自行选定订单。";
      }
      if (current.candidateOrderIds.length === 0 &&
          (answer.orderIds.length > 0 || (answer.status !== "needs_clarification" && answer.status !== "insufficient_evidence"))) {
        return "未查到当前用户的目标订单，不能给出确定退货判断；请核对订单信息。";
      }
    }
    return undefined;
  }

  return { prepareRequest, validateFinal, progress, prerequisiteError };
}
