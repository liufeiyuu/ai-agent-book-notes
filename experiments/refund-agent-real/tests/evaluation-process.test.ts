import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CASES, evaluatePolicySearches, type PolicySearchObservation } from "../src/evaluation";
import { runConsultation } from "../src/runner";
import { loadOrders } from "../src/orders";
import { DEMO_TODAY } from "../src/config";
import type { Model, ModelResponse } from "../../minimal-agent-ts/src/types";
import type { IndexArtifact } from "../src/types";

const scope = { category: "bone-conduction", channel: "official", policyDate: "2026-09-02" };
const empty = (query = "退货政策"): PolicySearchObservation => ({ query, scope, ranking: [] });

test("saved real traces keep valid cases and expose the previously unscored process failure", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/evaluation/b2-traces.json", import.meta.url), "utf8"));
  for (const row of fixture.records) {
    const check = evaluatePolicySearches(row.searches);
    assert.equal(check.passed, row.expectedProcessPassed, `${row.source}:${row.caseId}`);
    assert.equal(row.historicalChecks.every((item: { passed: boolean }) => item.passed), row.historicalAutomatedPassed);
    assert.equal(row.historicalAutomatedPassed && check.passed, row.expectedCombinedPassed);
    if (!check.passed) assert.deepEqual(check.violations, [
      { firstEmptySearch: 1, repeatedSearch: 2 }, { firstEmptySearch: 1, repeatedSearch: 3 },
    ]);
  }
});

test("no search or one successful empty search does not itself violate the stop rule", () => {
  assert.equal(evaluatePolicySearches([]).passed, true); // 是否完成必需查询仍由原有检查判断。
  assert.equal(evaluatePolicySearches([empty()]).passed, true);
});

test("zero candidates is scoped by category, channel and policy date, even across intervening searches", () => {
  for (const change of [{ category: "headphones" }, { channel: "partner" }, { policyDate: "2026-08-20" }]) {
    const other = { ...empty(), scope: { ...scope, ...change } };
    assert.equal(evaluatePolicySearches([empty(), other]).passed, true);
    assert.deepEqual(evaluatePolicySearches([empty(), other, empty("换一个搜索词")]).violations,
      [{ firstEmptySearch: 1, repeatedSearch: 3 }]);
  }
});

test("nonzero candidates still permit follow-up searches; an empty hits list is not the criterion", () => {
  const withCandidates = { ...empty(), ranking: [{ chunkId: "some-policy#1", score: 0.5, rank: 1 }], hits: [] };
  assert.equal(evaluatePolicySearches([withCandidates, { ...withCandidates, query: "补查拆封条件" }]).passed, true);
});

test("a correct final answer must not hide repeated searches after zero policy candidates", async () => {
  const expected = CASES.find(item => item.id === "missing")!;
  const tool = (id: string, name: string, args: unknown): ModelResponse => ({
    message: { role: "assistant", content: null, toolCalls: [{ id, name, arguments: args }] }, finishReason: "tool_calls",
  });
  // 离线脚本重现旧记录的动作顺序；不生成真实模型回答，也不发网络请求。
  const script: ModelResponse[] = [
    tool("order", "query_orders", { order_id: "B1003" }),
    ...["骨传导耳机拆封退货期限", "耳机拆封退货政策", "退货退款条件"].map((query, i) =>
      tool(`search-${i}`, "search_policy", { order_id: "B1003", query })),
    { message: { role: "assistant", toolCalls: [], content: JSON.stringify({
      status: "insufficient_evidence", orderIds: ["B1003"],
      answer: "已查询订单，但没有适用的骨传导耳机退货政策，无法判断。",
      citations: [], missingInformation: ["适用的骨传导耳机退货政策"],
    }) }, finishReason: "stop" },
  ];
  let calls = 0;
  const model: Model = { async generate() { return script[calls++]!; } };
  const index: IndexArtifact = { schemaVersion: 1, embeddingModel: "offline-unused", dimension: 2,
    fingerprint: "offline-empty-policy-fixture", createdAt: "test", entries: [] };
  const result = await runConsultation({ mode: "agent", question: expected.question, orderId: "B1003",
    today: DEMO_TODAY, userId: "demo-user", orders: await loadOrders(), index, topK: 3, model, expected,
    embedder: { model: "offline-unused", async embed() { throw new Error("Empty candidates must not call embedding"); } },
  });
  assert.equal(calls, 5);
  assert.equal(result.searches.length, 3);
  assert.equal(result.evaluation.checks.find(check => check.name === "expected_decision")?.passed, true);
  assert.equal(result.evaluation.checks.find(check => check.name === "workflow_complete")?.passed, true);
  assert.equal(result.evaluation.automatedPassed, false);
  assert.deepEqual(result.evaluation.checks.filter(check => !check.passed).map(check => check.name),
    ["no_search_after_empty_candidates"]);
});
