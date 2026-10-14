import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDraftWorkflow } from "./draft-workflow";
import { PermissionDeniedError, TemporaryToolError } from "./tool-errors";

const content = "项目周报：异步任务实验已完成。";
const trace: unknown[] = [];
const checks: string[] = [];
function record(event: string, detail: object): void {
  const row = { seq: trace.length + 1, event, ...detail };
  trace.push(structuredClone(row));
  console.log(JSON.stringify(row));
}
function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  checks.push(name);
}

// 每个场景独立建工作流与草稿集合；它们各自的 A1 不代表同一请求。
// 故障由本地钩子在 Map.set 之前抛出，不模拟真实服务或写入结果不明的超时。
async function runCase(scenario: string, fault: (attempt: number) => void) {
  const drafts = new Map<string, string>();
  const beforeWrites: Array<{ attempt: number; draftCount: number }> = [];
  const workflow = createDraftWorkflow(drafts, {
    maxAttempts: 3,
    beforeSave: () => {
      beforeWrites.push({ attempt: beforeWrites.length + 1, draftCount: drafts.size });
      fault(beforeWrites.length);
    },
  });
  const request = workflow.propose({ content }, "save-001");
  workflow.decideFromUser(request.requestId, "approve"); // 驱动模拟用户批准一次。
  const result = await workflow.execute(request.requestId);
  record(scenario, { beforeWrites, request: result, draftCount: drafts.size });
  return { drafts, workflow, result, beforeWrites };
}

// 前两次没有写入；第三次钩子放行，才真正保存一份草稿。
const recovered = await runCase("temporary_failure_then_success", attempt => {
  if (attempt <= 2) throw new TemporaryToolError("Storage temporarily unavailable before saving.");
});
check("two_temporary_failures_then_one_save", recovered.result.status === "succeeded"
  && recovered.result.attempts.length === 3 && recovered.drafts.size === 1
  && [...recovered.drafts.values()][0] === content
  && recovered.beforeWrites.every(row => row.draftCount === 0)
  && recovered.result.attempts.slice(0, 2).every(result => !result.ok
    && result.error.code === "temporary_unavailable" && result.error.retryable));

// 即使每次都属于可重试错误，第三次之后也必须停止。
const exhausted = await runCase("temporary_failure_hits_limit", () => {
  throw new TemporaryToolError("Storage remains unavailable.");
});
check("temporary_failure_stops_at_three_total_attempts", exhausted.result.status === "failed"
  && exhausted.result.stopReason === "attempt_limit" && exhausted.result.attempts.length === 3
  && exhausted.beforeWrites.length === 3 && exhausted.drafts.size === 0);
const resubmitted = exhausted.workflow.propose({ content }, "save-001");
const replay = await exhausted.workflow.execute(resubmitted.requestId);
check("same_key_replay_does_not_reset_attempt_limit", JSON.stringify(replay) === JSON.stringify(exhausted.result)
  && exhausted.beforeWrites.length === 3 && exhausted.drafts.size === 0);
record("replay_after_attempt_limit", { request: replay, draftCount: exhausted.drafts.size });

const denied = await runCase("permission_denied", () => {
  throw new PermissionDeniedError("No write permission.");
});
check("permission_denial_stops_after_one_attempt", denied.result.stopReason === "non_retryable"
  && denied.result.attempts.length === 1 && denied.drafts.size === 0
  && denied.result.toolResult?.ok === false && denied.result.toolResult.error.code === "permission_denied");

const unknown = await runCase("unknown_error", () => {
  throw new Error("Unexpected storage failure.");
});
check("unknown_error_stops_after_one_attempt", unknown.result.stopReason === "non_retryable"
  && unknown.result.attempts.length === 1 && unknown.drafts.size === 0
  && unknown.result.toolResult?.ok === false && unknown.result.toolResult.error.code === "execution_error");

// 非法正文在 propose 就被拒绝，尚未创建待审批请求，更不会进入重试循环。
const invalidDrafts = new Map<string, string>();
const invalidWorkflow = createDraftWorkflow(invalidDrafts);
let invalidMessage = "";
try { invalidWorkflow.propose({ content: "   " }, "invalid-content"); }
catch (error) { invalidMessage = error instanceof Error ? error.message : String(error); }
check("invalid_content_is_rejected_before_execution", invalidMessage === "content must not be blank."
  && invalidDrafts.size === 0);
record("invalid_content", { error: invalidMessage, executionAttempts: 0, draftCount: invalidDrafts.size });

const destination = new URL(`../runs/retry-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
await mkdir(destination, { recursive: false });
await writeFile(new URL("result.json", destination), JSON.stringify({
  mode: "offline_program_demo", realModelCalls: 0, mockModelCalls: 0,
  decisionSource: "test driver simulates user approval; local pre-write fault injection; no model is called",
  content, checks, trace,
}, null, 2) + "\n", { flag: "wx" });
console.log(`PASS retry: checks=${checks.length}; model calls=0`);
console.log(`证据目录：${fileURLToPath(destination)}`);
