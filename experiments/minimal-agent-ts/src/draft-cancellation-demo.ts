import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDraftWorkflow } from "./draft-workflow";

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

// 场景一：先批准，再在调用 execute 前取消。此驱动模拟应用接收用户的决定。
const beforeDrafts = new Map<string, string>();
const beforeWorkflow = createDraftWorkflow(beforeDrafts);
const beforeRequest = beforeWorkflow.propose({ content }, "cancel-before-write");
beforeWorkflow.decideFromUser(beforeRequest.requestId, "approve");
const beforeController = new AbortController();
record("approved_before_cancel", {
  request: beforeWorkflow.get(beforeRequest.requestId),
  signalAborted: beforeController.signal.aborted, draftCount: beforeDrafts.size,
});
beforeController.abort();
check("abort_changes_signal_before_workflow_processes_it", beforeController.signal.aborted
  && beforeWorkflow.get(beforeRequest.requestId).status === "approved");
record("abort_before_execute", {
  request: beforeWorkflow.get(beforeRequest.requestId),
  signalAborted: beforeController.signal.aborted, draftCount: beforeDrafts.size,
});
// execute 把信号传给执行器；入口检查直接返回 cancelled，原保存工具不会被调用。
const cancelled = await beforeWorkflow.execute(beforeRequest.requestId, beforeController.signal);
check("pre_cancelled_execution_reports_cancelled", cancelled.status === "cancelled"
  && cancelled.toolResult?.ok === false && cancelled.toolResult.error.code === "cancelled"
  && cancelled.toolResult.error.retryable === false);
check("pre_cancelled_execution_has_no_draft", beforeDrafts.size === 0);
record("execute_with_cancelled_signal", {
  request: cancelled, signalAborted: beforeController.signal.aborted, draftCount: beforeDrafts.size,
});

// 场景二使用独立集合和工作流。它的 A1 与上面的 A1 是不同请求。
const afterDrafts = new Map<string, string>();
const afterWorkflow = createDraftWorkflow(afterDrafts);
const afterRequest = afterWorkflow.propose({ content }, "cancel-after-write");
afterWorkflow.decideFromUser(afterRequest.requestId, "approve");
const afterController = new AbortController();
const saved = await afterWorkflow.execute(afterRequest.requestId, afterController.signal);
check("uncancelled_execution_saves_the_content", saved.status === "succeeded"
  && saved.toolResult?.ok === true && afterDrafts.size === 1 && [...afterDrafts.values()][0] === content);
record("saved_before_cancel", {
  request: saved, signalAborted: afterController.signal.aborted, draftCount: afterDrafts.size,
});
// 明确等到保存成功才取消；没有模拟写入中途的竞争或数据库回滚。
afterController.abort();
check("late_abort_preserves_saved_state", afterController.signal.aborted
  && JSON.stringify(afterWorkflow.get(afterRequest.requestId)) === JSON.stringify(saved)
  && afterDrafts.size === 1);
record("abort_after_save", {
  request: afterWorkflow.get(afterRequest.requestId),
  signalAborted: afterController.signal.aborted, draftCount: afterDrafts.size,
});
// 再执行已成功请求仍返回原结果；既不新增草稿，也不删除已有草稿。
const replay = await afterWorkflow.execute(afterRequest.requestId, afterController.signal);
check("late_execute_preserves_original_result_and_draft", JSON.stringify(replay) === JSON.stringify(saved)
  && afterDrafts.size === 1 && [...afterDrafts.values()][0] === content);
record("execute_after_late_cancel", {
  request: replay, signalAborted: afterController.signal.aborted, draftCount: afterDrafts.size,
});

const destination = new URL(`../runs/cancellation-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
await mkdir(destination, { recursive: false });
await writeFile(new URL("result.json", destination), JSON.stringify({
  mode: "offline_program_demo", realModelCalls: 0, mockModelCalls: 0,
  decisionSource: "test driver simulates user approval and cancellation; no model is called",
  content, checks, trace,
}, null, 2) + "\n", { flag: "wx" });
console.log(`PASS cancellation: checks=${checks.length}; model calls=0`);
console.log(`证据目录：${fileURLToPath(destination)}`);
