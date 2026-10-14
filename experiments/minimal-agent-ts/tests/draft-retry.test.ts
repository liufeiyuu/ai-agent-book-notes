import assert from "node:assert/strict";
import test from "node:test";
import { createDraftWorkflow } from "../src/draft-workflow";
import { PermissionDeniedError, TemporaryToolError } from "../src/tool-errors";

test("two pre-write temporary failures retry the approved request and save exactly once", async () => {
  const drafts = new Map<string, string>();
  let calls = 0;
  const workflow = createDraftWorkflow(drafts, {
    beforeSave: () => {
      calls++;
      assert.equal(drafts.size, 0);
      assert.equal(workflow.get(request.requestId).status, "running");
      if (calls <= 2) throw new TemporaryToolError("Storage temporarily unavailable before saving.");
    },
  });
  const request = workflow.propose({ content: "  原正文  " }, "save-001");
  workflow.decideFromUser(request.requestId, "approve");
  const saved = await workflow.execute(request.requestId);
  assert.equal(saved.status, "succeeded");
  assert.equal(saved.stopReason, "succeeded");
  assert.equal(saved.maxAttempts, 3);
  assert.deepEqual(saved.attempts.map(result => result.ok ? "success" : result.error.code),
    ["temporary_unavailable", "temporary_unavailable", "success"]);
  assert.ok(saved.attempts.every(result => result.toolCallId === `draft-${request.requestId}`));
  assert.equal(calls, 3);
  assert.deepEqual([...drafts.values()], ["  原正文  "]);
  assert.deepEqual(await workflow.execute(request.requestId), saved);
  assert.equal(calls, 3);
});

test("attempt limits include the first call and terminal replay cannot reset the budget", async () => {
  for (const limit of [1, 2, 3]) {
    const drafts = new Map<string, string>();
    let calls = 0;
    const options = {
      maxAttempts: limit,
      beforeSave: () => { calls++; throw new TemporaryToolError("Still unavailable."); },
    };
    const workflow = createDraftWorkflow(drafts, options);
    options.maxAttempts = 99; // 配置及返回对象都不能在外部改大内部上限。
    const request = workflow.propose({ content: "正文" }, "save-001");
    request.maxAttempts = 99;
    workflow.decideFromUser(request.requestId, "approve");
    const failed = await workflow.execute(request.requestId);
    assert.equal(failed.status, "failed");
    assert.equal(failed.stopReason, "attempt_limit");
    assert.equal(failed.attempts.length, limit);
    assert.equal(calls, limit);
    assert.equal(drafts.size, 0);
    const replay = workflow.propose({ content: "正文" }, "save-001");
    assert.deepEqual(replay, failed);
    replay.attempts.length = 0;
    replay.status = "approved";
    assert.deepEqual(await workflow.execute(replay.requestId), failed);
    assert.equal(calls, limit);
  }
});

test("permission denial and unknown errors stop after one call even with attempts remaining", async () => {
  for (const [error, code] of [
    [new PermissionDeniedError("No write permission."), "permission_denied"],
    [new Error("temporary_unavailable: this text alone must not authorize retry"), "execution_error"],
  ] as const) {
    const drafts = new Map<string, string>();
    let calls = 0;
    const workflow = createDraftWorkflow(drafts, { beforeSave: () => { calls++; throw error; } });
    const request = workflow.propose({ content: "正文" });
    workflow.decideFromUser(request.requestId, "approve");
    const result = await workflow.execute(request.requestId);
    assert.equal(result.status, "failed");
    assert.equal(result.stopReason, "non_retryable");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.toolResult?.ok, false);
    if (result.toolResult?.ok === false) {
      assert.equal(result.toolResult.error.code, code);
      assert.equal(result.toolResult.error.retryable, false);
    }
    assert.equal(calls, 1);
    assert.equal(drafts.size, 0);
  }
});

test("invalid input, missing approval, and rejection do not enter the retry loop", async () => {
  const drafts = new Map<string, string>();
  let calls = 0;
  const workflow = createDraftWorkflow(drafts, {
    beforeSave: () => { calls++; throw new TemporaryToolError("Unavailable."); },
  });
  assert.throws(() => workflow.propose({ content: "   " }), /must not be blank/);
  const request = workflow.propose({ content: "正文" });
  assert.equal((await workflow.execute(request.requestId)).attempts.length, 0);
  workflow.decideFromUser(request.requestId, "reject");
  const rejected = await workflow.execute(request.requestId);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.attempts.length, 0);
  assert.equal(calls, 0);
  assert.equal(drafts.size, 0);
});

test("cancellation during a retry prevents the write and stops further attempts", async () => {
  const drafts = new Map<string, string>();
  const controller = new AbortController();
  let calls = 0;
  const workflow = createDraftWorkflow(drafts, {
    beforeSave: () => {
      calls++;
      if (calls === 1) throw new TemporaryToolError("Unavailable on first attempt.");
      controller.abort(); // 钩子不抛错，工具仍必须在写入前响应取消。
    },
  });
  const request = workflow.propose({ content: "正文" });
  workflow.decideFromUser(request.requestId, "approve");
  const result = await workflow.execute(request.requestId, controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(result.stopReason, "cancelled");
  assert.deepEqual(result.attempts.map(attempt => attempt.ok ? "success" : attempt.error.code),
    ["temporary_unavailable", "cancelled"]);
  assert.equal(calls, 2);
  assert.equal(drafts.size, 0);
  assert.deepEqual(await workflow.execute(request.requestId), result);
  assert.equal(calls, 2);
});

test("invalid attempt limits are rejected before creating a workflow", () => {
  for (const maxAttempts of [0, -1, 4, 1.5, NaN, Infinity]) {
    assert.throws(() => createDraftWorkflow(new Map(), { maxAttempts }), /integer from 1 to 3/);
  }
});
