import type { Tool } from "../../minimal-agent-ts/src/types";
import { evidencePayload } from "./context";
import { orderFacts, scopeForOrder, visibleOrders } from "./orders";
import { retrieve } from "./retrieval";
import { record, type Embedder, type IndexArtifact, type Order, type SearchTrace } from "./types";

function argumentsObject(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!record(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid or unexpected tool arguments.");
  return input;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error(`Invalid ${name}.`);
  return value.trim();
}

export function createTools(options: { orders: Order[]; userId: string; today: string; index: IndexArtifact; embedder: Embedder; topK: number }) {
  const queriedOrders = new Map<string, Order>();
  // Record only successfully returned facts, not merely attempted tool calls.
  const orderQueries: Array<{ order_id?: string; keyword?: string; returnedOrderIds: string[] }> = [];
  const searches: SearchTrace[] = [];
  const policyOrderIds = new Set<string>();
  const cache = new Map<string, SearchTrace>();
  const queryOrders: Tool<{ order_id?: string; keyword?: string }> = {
    name: "query_orders",
    description: "查询当前用户订单。可按 order_id 精确查询，或按商品 keyword 字面筛选；不确定时无参数列出候选。多个候选需要请用户选择。",
    inputSchema: { type: "object", properties: { order_id: { type: "string" }, keyword: { type: "string" } }, additionalProperties: false },
    parseArguments(input) {
      const object = argumentsObject(input, ["order_id", "keyword"]);
      const order_id = optionalString(object.order_id, "order_id"), keyword = optionalString(object.keyword, "keyword");
      return { ...(order_id === undefined ? {} : { order_id }), ...(keyword === undefined ? {} : { keyword }) };
    },
    async execute(args, signal) {
      signal?.throwIfAborted();
      const orders = visibleOrders(options.orders, options.userId, args.order_id, args.keyword);
      const output = { source: "fixtures/orders.json", businessDate: options.today,
        orders: orders.map(order => orderFacts(order, options.today)), multipleCandidates: orders.length > 1 };
      orderQueries.push({ ...args, returnedOrderIds: orders.map(order => order.id) });
      for (const order of orders) queriedOrders.set(order.id, order);
      return output;
    },
  };

  // 学习入口 5：模型只提供检索意图与订单 ID；过滤条件由已核验的订单事实产生。
  const searchPolicy: Tool<{ order_id: string; query: string }> = {
    name: "search_policy",
    description: "检索适用于已查询订单的政策。自动按购买日期、品类和渠道过滤，返回真实向量检索的原文块与引用 ID。query 应说明需要查的期限或拆封等条件。",
    inputSchema: { type: "object", properties: { order_id: { type: "string" }, query: { type: "string" } }, required: ["order_id", "query"], additionalProperties: false },
    parseArguments(input) {
      const object = argumentsObject(input, ["order_id", "query"]);
      const order_id = optionalString(object.order_id, "order_id"), query = optionalString(object.query, "query");
      if (!order_id || !query) throw new Error("order_id and query are required.");
      return { order_id, query };
    },
    async execute(args, signal) {
      signal?.throwIfAborted();
      const order = queriedOrders.get(args.order_id);
      if (!order) throw new Error("Query this user's order first; unobserved orders cannot supply policy filters.");
      const key = JSON.stringify([args.order_id, args.query]);
      let trace = cache.get(key);
      const cacheHit = trace !== undefined;
      if (!trace) {
        // 执行检索
        trace = await retrieve(args.query, scopeForOrder(order), options.index, options.embedder, options.topK, signal);
        cache.set(key, trace);
      }
      // 模型不会自动看见项目里的文件，程序必须把内容送给它。检索工具把政策原文放进返回结果
      // evidence: evidencePayload(trace.hits) 把检索选中的块，整理成工具返回的 evidence。
      const output = { orderId: order.id, scope: trace.scope, cacheHit, evidence: evidencePayload(trace.hits),
        applicableCandidateCount: trace.ranking.length,
        missingEvidence: trace.hits.length === 0,
        note: trace.ranking.length === 0
          ? "业务范围内不存在政策候选。改变 query 不会产生适用条款；应停止搜索并说明缺少此范围的政策。"
          : "结果来自按订单适用范围过滤后的知识库；核对条款，证据已覆盖所需条件时直接回答，不重复查证同一事实。" };
      signal?.throwIfAborted();
      // 保存检索记录
      searches.push(trace);
      // 记录这笔订单的政策已搜索过。
      policyOrderIds.add(order.id); // A successful empty result counts; a thrown error does not.
      return output;
    },
  };
  return { tools: [queryOrders, searchPolicy] as Tool[], queriedOrders, orderQueries, searches, policyOrderIds };
}
