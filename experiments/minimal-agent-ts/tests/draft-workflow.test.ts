import assert from "node:assert/strict";
import test from "node:test";
import { createDraftWorkflow } from "../src/draft-workflow";

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
