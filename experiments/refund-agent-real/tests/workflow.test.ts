import test from "node:test";
import assert from "node:assert/strict";
import type { AgentRunResult, ModelInput, ModelResponse } from "../../minimal-agent-ts/src/types";
import { loadChunks, corpusFingerprint } from "../src/corpus";
import { loadOrders } from "../src/orders";
import { DEMO_TODAY } from "../src/config";
import { createTools } from "../src/tools";
import { createWorkflow } from "../src/workflow";
import { runConsultation } from "../src/runner";
import { CallBudget, createChatModel } from "../src/provider";
import type { Embedder, IndexArtifact } from "../src/types";

const chunks = await loadChunks(), orders = await loadOrders();
const embeddingModel = "test-only-workflow";
const index: IndexArtifact = { schemaVersion: 1, embeddingModel, dimension: 2, createdAt: "test",
  fingerprint: corpusFingerprint(chunks, embeddingModel), entries: chunks.map(chunk => ({ chunk, vector: [1, 0] })) };
const embedder: Embedder = { model: embeddingModel, async embed(texts) { return { vectors: texts.map(() => [1, 0]), usage: null }; } };
const base = { today: DEMO_TODAY, userId: "demo-user", orders, index, embedder, topK: 3 };
const final = (content: string): ModelResponse => ({ message: { role: "assistant", content, toolCalls: [] }, finishReason: "stop" });
const call = (id: string, name: string, args: unknown): ModelResponse => ({
  message: { role: "assistant", content: null, toolCalls: [{ id, name, arguments: args }] }, finishReason: "tool_calls",
});
const lookup = (id: string) => call(`lookup-${id}`, "query_orders", { order_id: id });
const search = (id: string) => call(`search-${id}`, "search_policy", { order_id: id, query: "拆封退货政策" });
const missingAnswer = { status: "insufficient_evidence", orderIds: ["B1003"],
  answer: "已查到 B1003 的订单信息，但未检索到适用的骨传导耳机政策，无法判断拆封后能否退货。",
  citations: [], missingInformation: ["适用于该订单的拆封退货条款"] };
const clarification = { status: "needs_clarification", orderIds: [], answer: "请确认具体订单。", citations: [], missingInformation: ["具体订单号"] };
// Replays the actual 2026-09-13 premature response; no live trace file or provider is needed.
const premature = JSON.stringify({ ...missingAnswer,
  answer: "我需要先确认订单 B1003 的购买与签收信息，再查询适用政策来判断拆封后的退货条件。",
  missingInformation: ["订单 B1003 的购买日期、签收日期、品类与渠道信息", "适用于该订单的拆封退货条款"] });

async function scripted(script: ModelResponse[], orderId?: string) {
  const inputs: ModelInput[] = [];
  const result = await runConsultation({ ...base, mode: "agent", question: orderId ? `${orderId} 拆封了能退吗？` : "上次那个耳机能退吗？",
    ...(orderId ? { orderId } : {}), model: { async generate(input) {
      inputs.push(structuredClone(input));
      assert.ok(script[inputs.length - 1], "Unexpected extra model call");
      return script[inputs.length - 1]!;
    } } });
  return { ...result, inputs, execution: result.execution as AgentRunResult };
}

test("actual premature JSON is rejected; subsequent real tools and empty policy complete the workflow", async () => {
  const result = await scripted([final(premature), lookup("B1003"), search("B1003"), final(JSON.stringify(missingAnswer))], "B1003");
  assert.equal(result.evaluation.automatedPassed, true);
  assert.deepEqual(result.knownOrderIds, ["B1003"]);
  assert.equal(result.searches.length, 1);
  assert.equal(result.searches[0]!.ranking.length, 0);
  assert.equal(result.formatRecovery, null);
  assert.equal(result.execution.trace.filter(event => event.type === "final_rejected").length, 1);
  assert.equal(result.execution.trace.filter(event => event.type === "tool_end" && event.result.ok).length, 2);
  assert.deepEqual(result.inputs.slice(0, 3).map(input => input.tools.map(tool => tool.name)),
    [["query_orders"], ["query_orders"], ["search_policy"]]);
  assert.deepEqual(result.inputs.slice(0, 3).map(input => input.toolChoice), ["required", "required", "required"]);
  assert.deepEqual((result.inputs[2]!.tools[0]!.inputSchema.properties as any).order_id.enum, ["B1003"]);
  assert.match(JSON.stringify(result.inputs[1]!.messages), /不能把用户提到的订单号当作已查询/);
  assert.deepEqual(result.workflow?.policyOrderIds, ["B1003"]);
});

for (const draft of [premature, "我先查一下订单。"])
  test(`refusal to use tools remains bounded with no format recovery: ${draft.slice(0, 16)}`, async () => {
    const result = await scripted(Array.from({ length: 6 }, () => final(draft)), "B1003");
    assert.equal(result.inputs.length, 6);
    assert.equal(result.execution.stopReason, "max_turns");
    assert.equal(result.execution.completed, false);
    assert.equal(result.execution.trace.filter(event => event.type === "final_rejected").length, 6);
    assert.equal(result.rawAnswer, "");
    assert.equal(result.evaluation.automatedPassed, false);
    assert.equal(result.formatRecovery, null);
  });

test("clarification status cannot bypass policy search after a single target is found", async () => {
  const result = await scripted([lookup("B1003"), final(JSON.stringify({ ...clarification, orderIds: ["B1003"] })),
    search("B1003"), final(JSON.stringify(missingAnswer))], "B1003");
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(result.execution.trace.filter(event => event.type === "final_rejected").length, 1);
});

test("a search of another observed order cannot satisfy the selected target", async () => {
  const result = await scripted([call("all", "query_orders", {}), search("H1001"), final(JSON.stringify(missingAnswer)),
    search("B1003"), final(JSON.stringify(missingAnswer))], "B1003");
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(result.execution.trace.filter(event => event.type === "final_rejected").length, 1);
  assert.deepEqual(result.workflow?.policyOrderIds, ["H1001", "B1003"]);
});

test("unrelated or keyword-filtered empty lookups do not verify a selected order", async () => {
  const state = createTools(base), workflow = createWorkflow(state, "B1003");
  await state.tools[0]!.execute({ order_id: "H1001" });
  assert.equal(workflow.progress().stage, "query_orders");
  await state.tools[0]!.execute({ order_id: "B1003", keyword: "not-the-product" });
  assert.equal(workflow.progress().stage, "query_orders");
  await state.tools[0]!.execute({ order_id: "b1003" });
  assert.equal(workflow.progress().stage, "search_policy");
});

test("unavailable selected order allows uncertainty after a successful lookup, without forced search", async () => {
  for (const id of ["PRIVATE-2001", "NOT-FOUND"]) {
    const result = await scripted([lookup(id), final(JSON.stringify(clarification))], id);
    assert.equal(result.evaluation.automatedPassed, true);
    assert.deepEqual(result.knownOrderIds, []);
    assert.equal(result.workflow?.stage, "clarify");
    assert.equal(result.searches.length, 0);
  }
});

test("ambiguous candidates cannot be resolved by an arbitrary later exact query", async () => {
  const state = createTools(base), workflow = createWorkflow(state);
  await state.tools[0]!.execute({ keyword: "耳机" });
  await state.tools[0]!.execute({ order_id: "B1003" });
  await state.tools[1]!.execute({ order_id: "B1003", query: "退货" });
  assert.equal(workflow.progress().stage, "clarify");
  assert.match(workflow.validateFinal(JSON.stringify(missingAnswer))!, /多个候选/);
  assert.equal(workflow.validateFinal(JSON.stringify(clarification)), undefined);
});

test("failed fact construction and failed policy retrieval never record success", async () => {
  const badDate = createTools({ ...base, today: "2020-01-01" });
  await assert.rejects(badDate.tools[0]!.execute({ order_id: "H1001" }), /Business date/);
  assert.equal(badDate.orderQueries.length, 0);
  assert.equal(badDate.queriedOrders.size, 0);
  assert.equal(createWorkflow(badDate).progress().stage, "query_orders");
  const badSearch = createTools({ ...base, embedder: { model: embeddingModel, async embed() { throw new Error("retrieval unavailable"); } } });
  await badSearch.tools[0]!.execute({ order_id: "H1001" });
  await assert.rejects(badSearch.tools[1]!.execute({ order_id: "H1001", query: "退货" }), /retrieval unavailable/);
  assert.equal(badSearch.searches.length, 0);
  assert.equal(badSearch.policyOrderIds.size, 0);
  assert.equal(createWorkflow(badSearch, "H1001").progress().stage, "search_policy");
});

test("invalid tool arguments leave required lookup pending", async () => {
  const result = await scripted([call("invalid", "query_orders", { userId: "other-user" }), final(premature),
    lookup("B1003"), search("B1003"), final(JSON.stringify(missingAnswer))], "B1003");
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(result.workflow?.orderQueries.length, 1);
  assert.ok(result.execution.trace.some(event => event.type === "tool_end" && !event.result.ok));
});

test("format recovery cannot change the verified target or invent an observed order", async () => {
  const result = await scripted([lookup("B1003"), search("B1003"), final("解释然后是 JSON"),
    final(JSON.stringify({ ...missingAnswer, orderIds: ["H1001"] }))], "B1003");
  assert.equal(result.inputs.length, 4);
  assert.equal(result.inputs[3]!.tools.length, 0);
  assert.ok(result.formatRecovery);
  assert.equal(result.evaluation.automatedPassed, false);
  assert.ok(result.evaluation.checks.some(check => check.name === "workflow_complete" && !check.passed));
});

test("required tool transport omits final JSON schema; answer transport restores it", async () => {
  const sent: any[] = [];
  const model = createChatModel("test-secret", "deepseek/deepseek-v4-flash-0731", new CallBudget(2), 1500, async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(missingAnswer) }, finish_reason: "stop" }] });
  });
  const state = createTools(base), workflow = createWorkflow(state, "B1003");
  const input = { messages: [{ role: "user" as const, content: "B1003 能退吗" }],
    tools: state.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  await model.generate(workflow.prepareRequest(input));
  await model.generate({ ...input, tools: [] });
  assert.equal(sent[0].tool_choice, "required");
  assert.equal(sent[0].response_format, undefined);
  assert.equal(sent[0].tools.length, 1);
  assert.equal(sent[0].tools[0].function.name, "query_orders");
  assert.equal(sent[1].response_format.type, "json_schema");
  assert.deepEqual(model.transportRequests, sent);
});
