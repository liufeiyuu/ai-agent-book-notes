import assert from "node:assert/strict";
import test from "node:test";
import { createDraftWorkflow, IdempotencyConflictError } from "../src/draft-workflow";

test("valid proposals wait without writing until explicitly approved", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const input = { content: "  原正文  " };
  const proposal = workflow.propose(input);
  assert.equal((await workflow.execute(proposal.requestId)).status, "waiting_approval");
  assert.equal(drafts.size, 0);
  input.content = "外部改写";
  proposal.arguments.content = "改写返回对象";
  proposal.status = "approved";
  assert.equal((await workflow.execute(proposal.requestId)).status, "waiting_approval");
  const approved = workflow.decideFromUser(proposal.requestId, "approve");
  assert.equal(approved.status, "approved");
  assert.equal(drafts.size, 0);
  approved.arguments.content = "批准后替换正文";
  const result = await workflow.execute(proposal.requestId);
  assert.equal(result.status, "succeeded");
  assert.deepEqual([...drafts.values()], ["  原正文  "]);
});

test("rejection is terminal and executing a rejected request never writes", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const request = workflow.propose({ content: "正文" });
  workflow.decideFromUser(request.requestId, "reject");
  assert.equal((await workflow.execute(request.requestId)).status, "rejected");
  assert.equal(drafts.size, 0);
  assert.throws(() => workflow.decideFromUser(request.requestId, "approve"), /no longer waiting/);
});

test("approval is bound to one request and cannot authorize another content", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const first = workflow.propose({ content: "正文 A" });
  const second = workflow.propose({ content: "正文 B" });
  workflow.decideFromUser(first.requestId, "approve");
  assert.equal((await workflow.execute(second.requestId)).status, "waiting_approval");
  assert.equal(drafts.size, 0);
  await workflow.execute(first.requestId);
  assert.deepEqual([...drafts.values()], ["正文 A"]);
});

test("model-supplied approval fields and invalid controller decisions cannot approve", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  assert.throws(() => workflow.propose({ content: "正文", approved: true }), /Only content/);
  const request = workflow.propose({ content: "正文" });
  // 模拟绕过 TypeScript 的非法运行时输入，不能靠 truthy 值获批。
  assert.throws(() => workflow.decideFromUser(request.requestId, "yes" as "approve"), /Decision must/);
  assert.equal((await workflow.execute(request.requestId)).status, "waiting_approval");
  assert.equal(drafts.size, 0);
});

test("same key and content reuse approval state and the saved result without another draft", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const first = workflow.propose({ content: "正文" }, "save-001");
  const waiting = workflow.propose({ content: "正文" }, "save-001");
  assert.deepEqual(waiting, first);
  assert.equal((await workflow.execute(waiting.requestId)).status, "waiting_approval");
  assert.equal(drafts.size, 0);
  workflow.decideFromUser(first.requestId, "approve");
  assert.equal(workflow.propose({ content: "正文" }, "save-001").status, "approved");
  const saved = await workflow.execute(first.requestId);
  assert.equal(saved.status, "succeeded");
  const replay = workflow.propose({ content: "正文" }, "save-001");
  assert.deepEqual(replay, saved);
  assert.deepEqual(await workflow.execute(replay.requestId), saved);
  assert.equal(drafts.size, 1);
  // 返回结果也是副本，调用方改它不会污染后续重放。
  replay.status = "approved";
  delete replay.toolResult;
  assert.deepEqual(workflow.propose({ content: "正文" }, "save-001"), saved);
});

test("same key with changed content conflicts before or after saving and preserves the original", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const first = workflow.propose({ content: "原正文" }, "save-001");
  const checkConflicts = () => {
    for (const content of ["另一份正文", "原正文 "]) {
      assert.throws(() => workflow.propose({ content }, "save-001"), (error: unknown) => {
        assert.ok(error instanceof IdempotencyConflictError);
        assert.equal(error.code, "idempotency_conflict");
        assert.equal(error.requestId, first.requestId);
        return true;
      });
    }
  };
  checkConflicts();
  assert.equal(workflow.get(first.requestId).status, "waiting_approval");
  assert.equal(drafts.size, 0);
  workflow.decideFromUser(first.requestId, "approve");
  const saved = await workflow.execute(first.requestId);
  checkConflicts();
  assert.deepEqual(workflow.get(first.requestId), saved);
  assert.deepEqual([...drafts.values()], ["原正文"]);
});

test("different keys with identical content are separate operations requiring separate approval", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const first = workflow.propose({ content: "正文" }, "save-001");
  const second = workflow.propose({ content: "正文" }, "save-002");
  assert.notEqual(first.requestId, second.requestId);
  workflow.decideFromUser(first.requestId, "approve");
  await workflow.execute(first.requestId);
  assert.equal((await workflow.execute(second.requestId)).status, "waiting_approval");
  assert.equal(drafts.size, 1);
  workflow.decideFromUser(second.requestId, "approve");
  await workflow.execute(second.requestId);
  assert.equal(drafts.size, 2);
});

test("resubmitting a rejected key cannot create a fresh approval request", async () => {
  const drafts = new Map<string, string>();
  const workflow = createDraftWorkflow(drafts);
  const first = workflow.propose({ content: "正文" }, "save-001");
  workflow.decideFromUser(first.requestId, "reject");
  const replay = workflow.propose({ content: "正文" }, "save-001");
  assert.equal(replay.requestId, first.requestId);
  assert.equal(replay.status, "rejected");
  assert.equal((await workflow.execute(replay.requestId)).status, "rejected");
  assert.equal(drafts.size, 0);
});
