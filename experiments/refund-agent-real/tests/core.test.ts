import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkDocument, loadDocuments, loadChunks, corpusFingerprint } from "../src/corpus";
import { buildIndex, readIndex, validateIndex } from "../src/index-store";
import { CallBudget, OpenRouterEmbedder, validateVector, chatParameters, createChatModel } from "../src/provider";
import { cosine, exclusionReason, retrieve, formatRetrievalQuery } from "../src/retrieval";
import { ANSWER_SCHEMA } from "../src/answer";
import { loadOrders, orderFacts, scopeForOrder, visibleOrders } from "../src/orders";
import { createTools } from "../src/tools";
import { buildContext } from "../src/context";
import { CASES, evaluateAnswer, parseAnswer } from "../src/evaluation";
import { runConsultation } from "../src/runner";
import { DEMO_TODAY } from "../src/config";
import { validDate, type Chunk, type Embedder, type IndexArtifact, type SearchHit } from "../src/types";
import type { Model, ModelInput, ModelResponse } from "../../minimal-agent-ts/src/types";

// Offline doubles exist only in tests. Neither CLI nor production adapters can select them.
const chunks = await loadChunks();
const orders = await loadOrders();
const modelName = "test-only-vectors";

test("DeepSeek V4 uses non-thinking mode without changing other models' reasoning settings", () => {
  assert.deepEqual(chatParameters("deepseek/deepseek-v4-flash-0731", 1500).reasoning, { enabled: false });
  assert.equal(chatParameters("other/model", 1500).reasoning, undefined);
});

test("chat transport sends strict schema and required-parameter routing, without logging credentials", async () => {
  let sent: any;
  const model = createChatModel("test-secret", "deepseek/deepseek-v4-flash-0731", new CallBudget(1), 1500, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(answerFor()) }, finish_reason: "stop" }] });
  });
  await model.generate({ messages: [{ role: "user", content: "能退吗" }], tools: [] });
  assert.deepEqual(sent.response_format.json_schema.schema, ANSWER_SCHEMA);
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.provider.require_parameters, true);
  assert.equal(sent.reasoning.enabled, false);
  assert.equal(sent.max_tokens, 1500);
  assert.deepEqual(model.transportRequests, [sent]);
  assert.equal(JSON.stringify(model.transportRequests).includes("test-secret"), false);
});

test("Qwen retrieval adds a query-only task instruction and records the exact embedding input", async () => {
  const model = "qwen/qwen3-embedding-8b", embedder = { ...testEmbedder(), model };
  const result = await retrieve("包装拆了能退吗", scope(), { ...indexFor(), embeddingModel: model }, embedder);
  assert.match(result.embeddingQuery, /^Instruct: .*\nQuery:包装拆了能退吗$/);
  assert.deepEqual(embedder.calls[0], [result.embeddingQuery]);
  assert.equal(result.query, "包装拆了能退吗");
  assert.equal(formatRetrievalQuery("question", "other/model"), "question");
});

test("answer validation rejects prose, fences, extra fields, coercion and empty references", () => {
  const valid = answerFor(), json = JSON.stringify(valid);
  assert.deepEqual(parseAnswer(json), valid);
  for (const raw of [`Explanation\n${json}`, `\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060`,
    JSON.stringify({ ...valid, extra: true }), JSON.stringify({ ...valid, status: ["eligible"] }),
    JSON.stringify({ ...valid, citations: [{ chunkId: "", quote: "text" }] }),
    JSON.stringify({ ...valid, citations: [{ ...valid.citations[0], extra: true }] })]) assert.throws(() => parseAnswer(raw));
});
function indexFor(items = chunks): IndexArtifact {
  return { schemaVersion: 1, embeddingModel: modelName, dimension: 2, createdAt: "test",
    fingerprint: corpusFingerprint(items, modelName),
    entries: items.map(chunk => ({ chunk, vector: chunk.section === "期限与拆封条件" ? [1, 0] : [0, 1] })) };
}
function testEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return { model: modelName, calls, async embed(texts) { calls.push(texts); return { vectors: texts.map(() => [1, 0]), usage: { test: true } }; } };
}
function hitFor(id = "headphones-v2#1"): SearchHit {
  return { chunk: chunks.find(chunk => chunk.id === id)!, rank: 1, score: 1 };
}
function answerFor(hit = hitFor(), orderId = "H1001") {
  return { status: "eligible", orderIds: [orderId], answer: "满足政策咨询条件，不代表已执行退款。",
    citations: [{ chunkId: hit.chunk.id, quote: hit.chunk.text }], missingInformation: [] };
}
function response(content: string): ModelResponse { return { message: { role: "assistant", content, toolCalls: [] }, finishReason: "stop" }; }
function toolResponse(id: string, name: string, args: unknown): ModelResponse {
  return { message: { role: "assistant", content: null, toolCalls: [{ id, name, arguments: args }] }, finishReason: "tool_calls" };
}
function scope() { return scopeForOrder(orders.find(order => order.id === "H1001")!); }

test("chunking preserves complete conditions, carries provenance and keeps retrieval non-trivial", async () => {
  const docs = await loadDocuments();
  assert.equal(docs.length, 5);
  assert.equal(chunks.length, 14);
  const policy = hitFor().chunk;
  assert.match(policy.text, /7 个自然日/);
  assert.match(policy.text, /配件齐全、没有人为损坏/);
  assert.equal(policy.effectiveFrom, "2026-09-01");
  assert.equal(chunks.filter(chunk => chunk.documentId === "headphones-v2").length, 5);
  assert.equal(new Set(chunks.map(chunk => chunk.id)).size, chunks.length);
  assert.throws(() => chunkDocument(docs[0]!, 5), /Paragraph exceeds/);
});

test("calendar validation and policy intervals use effective dates, not publication or today's date", () => {
  assert.equal(validDate("2026-02-30"), false);
  const old = hitFor("headphones-v1#1").chunk, current = hitFor().chunk;
  assert.equal(exclusionReason(old, { ...scope(), policyDate: "2026-08-25" }), null);
  assert.equal(exclusionReason(current, { ...scope(), policyDate: "2026-08-25" }), "not_effective_yet");
  assert.equal(exclusionReason(old, scope()), "not_effective_for_this_order");
  assert.equal(exclusionReason(current, scope()), null);
  assert.equal(exclusionReason(current, { ...scope(), channel: "partner" }), "channel_mismatch");
});

test("vectors reject zero, mismatched dimensions and non-finite entries", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  for (const value of [[], [0, 0], [NaN], [Infinity], ["1"]]) assert.throws(() => validateVector(value));
  assert.throws(() => cosine([1, 0], [1]));
});

test("real embedding adapter sends API payload and associates vectors using response indexes", async () => {
  const calls: unknown[] = [];
  const fetch_: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/embeddings");
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 4 } });
  };
  const budget = new CallBudget(1), provider = new OpenRouterEmbedder("provider-model", "test-secret", budget, fetch_);
  const result = await provider.embed(["first", "second"]);
  assert.deepEqual(result.vectors, [[1, 0], [0, 1]]);
  assert.deepEqual(calls[0], { model: "provider-model", input: ["first", "second"], encoding_format: "float" });
  assert.equal(JSON.stringify(provider.exchanges).includes("test-secret"), false);
  await assert.rejects(provider.embed(["third"]), /budget exhausted/);
});

for (const [name, data] of Object.entries({
  count: [{ index: 0, embedding: [1, 0] }],
  duplicate: [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
  dimension: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1] }],
  index: [{ index: 3, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }],
})) test(`embedding adapter rejects malformed ${name}`, async () => {
  const provider = new OpenRouterEmbedder("m", "test", new CallBudget(1), async () => Response.json({ data }));
  await assert.rejects(provider.embed(["one", "two"]));
});

test("HTTP failure never falls back to fake vectors; pre-abort consumes no budget", async () => {
  const budget = new CallBudget(2);
  const provider = new OpenRouterEmbedder("m", "test", budget, async () => new Response("failure", { status: 401 }));
  await assert.rejects(provider.embed(["one"], AbortSignal.abort()), /abort/i);
  assert.equal(budget.used, 0);
  await assert.rejects(provider.embed(["one"]), /HTTP 401/);
  assert.equal(budget.used, 1);
});

test("provider errors preserve diagnostics but redact echoed credentials", async () => {
  const provider = new OpenRouterEmbedder("m", "test-secret", new CallBudget(1), async () => Response.json({
    error: { message: "Access denied for test-secret and sk-or-v1-another-secret" },
  }, { status: 403 }));
  await assert.rejects(provider.embed(["one"]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 403: Access denied/);
    assert.equal(error.message.includes("test-secret"), false);
    assert.equal(error.message.includes("sk-or-"), false);
    return true;
  });
});

test("index cache reuses vectors; changed source, metadata or model invalidate it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "refund-agent-index-test-"));
  try {
    const path = join(directory, "index.json"), embedder = testEmbedder();
    assert.equal((await buildIndex(chunks, embedder, path)).cacheHit, false);
    assert.equal((await buildIndex(chunks, embedder, path)).cacheHit, true);
    assert.equal(embedder.calls.length, 1);
    const changed: Chunk[] = chunks.map((chunk, i) => i === 0 ? { ...chunk, text: `${chunk.text}\nNew condition.` } : chunk);
    await assert.rejects(readIndex(changed, modelName, path), /stale/);
    assert.equal((await buildIndex(changed, embedder, path)).cacheHit, false);
    assert.equal(embedder.calls.length, 2);
    const index = indexFor();
    assert.throws(() => validateIndex(index, chunks, "other-model"));
    assert.throws(() => validateIndex(index, chunks.map(c => ({ ...c, effectiveFrom: "2025-01-01" })), modelName));
    assert.throws(() => validateIndex({ ...index, dimension: 7 }, chunks, modelName));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("retrieval filters business scope before ranking; top-k changes selection, not existing ranks", async () => {
  const embedder = testEmbedder();
  const one = await retrieve("能退吗", scope(), indexFor(), embedder, 1);
  const three = await retrieve("能退吗", scope(), indexFor(), embedder, 3);
  assert.equal(one.ranking.length, 5);
  assert.equal(one.hits[0]!.chunk.id, "headphones-v2#1");
  assert.equal(three.hits.length, 3);
  assert.deepEqual(one.ranking, three.ranking);
  assert.ok(one.excluded.some(item => item.chunkId.startsWith("headphones-v1") && item.reason === "not_effective_for_this_order"));
  assert.ok(three.hits.every(item => item.chunk.documentId === "headphones-v2"));
});

test("no applicable policy is empty evidence, not permission; incompatible embeddings fail closed", async () => {
  const embedder = testEmbedder();
  const missing = await retrieve("骨传导", { ...scope(), category: "bone-conduction" }, indexFor(), embedder);
  assert.equal(missing.hits.length, 0);
  assert.equal(embedder.calls.length, 0);
  await assert.rejects(retrieve("question", scope(), { ...indexFor(), embeddingModel: "different" }, embedder), /differ/);
  await assert.rejects(retrieve("question", scope(), { ...indexFor(), dimension: 7 }, embedder), /dimensions/);
});

test("orders enforce user scope and calculate twelve days separately from policy date", () => {
  assert.equal(visibleOrders(orders, "demo-user", "PRIVATE-2001").length, 0);
  const order = visibleOrders(orders, "demo-user", "h1002")[0]!;
  assert.equal(orderFacts(order, DEMO_TODAY).daysSinceDelivery, 12);
  assert.equal(scopeForOrder(order).policyDate, "2026-08-20");
  assert.equal("userId" in orderFacts(order, DEMO_TODAY), false);
});

test("tools reject unobserved orders and forged scope; repeated identical queries reuse results", async () => {
  const embedder = testEmbedder();
  const state = createTools({ orders, userId: "demo-user", today: DEMO_TODAY, index: indexFor(), embedder, topK: 3 });
  const query = state.tools[0]!, search = state.tools[1]!;
  await assert.rejects(search.execute(search.parseArguments({ order_id: "H1001", query: "退货" })), /first/);
  assert.throws(() => query.parseArguments({ userId: "other-user" }));
  assert.throws(() => search.parseArguments({ order_id: "H1001", query: "退货", policyDate: "2026-01-01" }));
  await query.execute(query.parseArguments({ order_id: "PRIVATE-2001" }));
  assert.equal(state.queriedOrders.size, 0);
  await query.execute(query.parseArguments({ order_id: "H1001" }));
  const args = search.parseArguments({ order_id: "H1001", query: "退货" });
  await search.execute(args); await search.execute(args);
  assert.equal(embedder.calls.length, 1);
  assert.equal(state.searches.length, 2);
});

test("context carries retrieved text and identifiers, never expected labels or vectors", () => {
  const messages = buildContext("能退吗", [orders[0]!], [hitFor()], DEMO_TODAY);
  const payload = JSON.parse(messages[1]!.content!);
  assert.equal(payload.retrievedEvidence[0].chunkId, "headphones-v2#1");
  assert.equal(payload.retrievedEvidence[0].text, hitFor().chunk.text);
  assert.equal("expectedStatus" in payload, false);
  assert.equal("vector" in payload.retrievedEvidence[0], false);
});

test("evaluation checks schema, actual source, exact quote and expected decision separately", () => {
  const answer = answerFor();
  const evaluate = (value: unknown) => evaluateAnswer(JSON.stringify(value), [hitFor()], ["H1001"], CASES[0]);
  assert.equal(evaluate(answer).automatedPassed, true);
  assert.equal(evaluate(answer).requiresHumanReview, true);
  assert.equal(evaluate({ ...answer, status: "ineligible" }).automatedPassed, false);
  assert.equal(evaluate({ ...answer, citations: [{ chunkId: "fabricated", quote: answer.citations[0]!.quote }] }).automatedPassed, false);
  assert.equal(evaluate({ ...answer, citations: [{ chunkId: "headphones-v2#1", quote: "无限期退款" }] }).automatedPassed, false);
  assert.equal(evaluate({ ...answer, orderIds: ["PRIVATE-2001"] }).automatedPassed, false);
  assert.equal(evaluate({ ...answer, citations: [] }).automatedPassed, false);
  assert.throws(() => parseAnswer("Not JSON"));
});

test("RAG runner actually passes retrieved evidence to model, withholding gold labels", async () => {
  let received: ModelInput | undefined;
  const model: Model = { async generate(input) { received = input; return response(JSON.stringify(answerFor())); } };
  const result = await runConsultation({ mode: "rag", question: CASES[0]!.question, orderId: "H1001", today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), model, topK: 3, expected: CASES[0]! });
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(received!.tools.length, 0);
  const payload = JSON.parse(received!.messages[1]!.content!);
  assert.equal(payload.retrievedEvidence.length, 3);
  assert.equal("expectedStatus" in payload, false);
});

test("Agent runner executes tool loop and preserves tool_call_id causality", async () => {
  const inputs: ModelInput[] = [];
  const script = [toolResponse("order-call", "query_orders", { order_id: "H1001" }),
    toolResponse("search-call", "search_policy", { order_id: "H1001", query: "拆封和退款期限" }), response(JSON.stringify(answerFor()))];
  const model: Model = { async generate(input) { inputs.push(structuredClone(input)); return script[inputs.length - 1]!; } };
  const result = await runConsultation({ mode: "agent", question: CASES[0]!.question, today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), model, topK: 3, expected: CASES[0]! });
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs[2]!.messages.filter(m => m.role === "tool").map(m => m.toolCallId), ["order-call", "search-call"]);
  assert.equal(result.searches.length, 1);
});

test("model guessing an answer without tool evidence fails even if decision matches gold", async () => {
  const model: Model = { async generate() { return response(JSON.stringify(answerFor())); } };
  const result = await runConsultation({ mode: "agent", question: CASES[0]!.question, today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), model, topK: 3, expected: CASES[0]! });
  assert.equal(result.evaluation.automatedPassed, false);
  assert.ok(result.evaluation.checks.some(c => c.name === "expected_decision" && c.passed));
  assert.ok(result.evaluation.checks.some(c => c.name === "orders_actually_queried" && !c.passed));
});

test("endless agent is bounded, and a stopped run is not a successful task", async () => {
  let calls = 0;
  const model: Model = { async generate() { return toolResponse(`call-${++calls}`, "query_orders", {}); } };
  const result = await runConsultation({ mode: "agent", question: "能退吗", today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), model, topK: 3 });
  assert.equal(calls, 6);
  assert.equal(result.evaluation.automatedPassed, false);
  assert.equal((result.execution as { stopReason: string }).stopReason, "max_turns");
});

test("RAG generation failure retains retrieved ranking and fails closed", async () => {
  const result = await runConsultation({ mode: "rag", question: "能退吗", orderId: "H1001", today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), topK: 3,
    model: { async generate() { throw new Error("provider unavailable"); } } });
  assert.equal(result.searches[0]!.ranking.length, 5);
  assert.equal(result.evaluation.automatedPassed, false);
  assert.match(JSON.stringify(result.execution), /provider unavailable/);
});

test("malformed output gets only one tool-free regeneration from observed evidence", async () => {
  for (const repairSucceeds of [true, false]) {
    const inputs: ModelInput[] = [];
    const model: Model = { async generate(input) {
      inputs.push(structuredClone(input));
      return response(inputs.length === 2 && repairSucceeds ? JSON.stringify(answerFor()) : `Prose ${JSON.stringify(answerFor())}`);
    } };
    const result = await runConsultation({ mode: "rag", question: "能退吗", orderId: "H1001", today: DEMO_TODAY,
      userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), topK: 3, model, expected: CASES[0]! });
    assert.equal(inputs.length, 2);
    assert.equal(inputs[1]!.tools.length, 0);
    assert.match(JSON.stringify(result.formatRecovery), /Prose/);
    assert.equal(result.evaluation.automatedPassed, repairSucceeds);
    assert.equal(JSON.parse(inputs[1]!.messages[1]!.content!).retrievedEvidence.length, 3);
  }
});

test("an actual order lookup with no accessible results is not a skipped lookup", async () => {
  let calls = 0;
  const model: Model = { async generate() { return ++calls === 1
    ? toolResponse("lookup", "query_orders", { order_id: "PRIVATE-2001" })
    : response(JSON.stringify({ status: "needs_clarification", orderIds: [], answer: "请核对您自己的订单号。", citations: [], missingInformation: ["当前用户可访问的订单号"] })); } };
  const result = await runConsultation({ mode: "agent", question: "查 PRIVATE-2001", today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), topK: 3, model });
  assert.equal(result.evaluation.automatedPassed, true);
  assert.deepEqual(result.knownOrderIds, []);
  assert.equal(result.searches.length, 0);
});

test("Agent format recovery preserves tool trace, cannot acquire new facts, and has no gold labels", async () => {
  const inputs: ModelInput[] = [];
  const script = [toolResponse("order", "query_orders", { order_id: "H1001" }),
    toolResponse("policy", "search_policy", { order_id: "H1001", query: "退货" }),
    response(`Explanation ${JSON.stringify(answerFor())}`), response(JSON.stringify(answerFor()))];
  const model: Model = { async generate(input) { inputs.push(structuredClone(input)); return script[inputs.length - 1]!; } };
  const result = await runConsultation({ mode: "agent", question: CASES[0]!.question, today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), topK: 3, model, expected: CASES[0]! });
  assert.equal(result.evaluation.automatedPassed, true);
  assert.equal(inputs.length, 4);
  assert.equal(inputs[3]!.tools.length, 0);
  const context = JSON.parse(inputs[3]!.messages[1]!.content!);
  assert.deepEqual(context.orderFacts.map((order: { id: string }) => order.id), ["H1001"]);
  assert.equal(context.retrievedEvidence.length, 3);
  assert.equal("expectedStatus" in context, false);
  assert.match(JSON.stringify(result.execution), /Explanation/);
  assert.equal(result.searches.length, 1);
});

test("format recovery budget errors remain failures; empty policy candidates explain why rephrasing is futile", async () => {
  let calls = 0;
  const model: Model = { async generate() {
    if (++calls === 1) return response("malformed");
    throw new Error("API call budget exhausted");
  } };
  const result = await runConsultation({ mode: "rag", question: "能退吗", orderId: "H1001", today: DEMO_TODAY,
    userId: "demo-user", orders, index: indexFor(), embedder: testEmbedder(), topK: 3, model });
  assert.equal(calls, 2);
  assert.equal(result.evaluation.automatedPassed, false);
  assert.match(JSON.stringify(result.formatRecovery), /budget exhausted/);
  const state = createTools({ orders, userId: "demo-user", today: DEMO_TODAY, index: indexFor(), embedder: testEmbedder(), topK: 3 });
  await state.tools[0]!.execute({ order_id: "B1003" });
  const search = await state.tools[1]!.execute({ order_id: "B1003", query: "退货" });
  assert.match(JSON.stringify(search), /"applicableCandidateCount":0/);
  assert.match(JSON.stringify(search), /改变 query 不会产生适用条款/);
});
