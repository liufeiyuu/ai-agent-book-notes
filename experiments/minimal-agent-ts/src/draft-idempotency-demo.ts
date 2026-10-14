import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDraftWorkflow, IdempotencyConflictError } from "./draft-workflow";

const content = "项目周报：异步任务实验已完成。";
const idempotencyKey = "save-001";
const drafts = new Map<string, string>();
const workflow = createDraftWorkflow(drafts);
const trace: unknown[] = [];
const checks: string[] = [];
function record(event: string, detail: object): void {
  const row = { seq: trace.length + 1, event, ...detail, draftCount: drafts.size };
  trace.push(structuredClone(row));
  console.log(JSON.stringify(row));
}
function check(name: string, condition: boolean): void {
  assert.ok(condition, name);
  checks.push(name);
}

// 首次提交就登记 save-001 → A1；键由调用方保留，用于之后重发同一次操作。
const first = workflow.propose({ content }, idempotencyKey);
record("first_proposal", { request: first });
const waitingReplay = workflow.propose({ content }, idempotencyKey);
check("pending_repeat_reuses_request_without_writing", waitingReplay.requestId === first.requestId
  && waitingReplay.status === "waiting_approval" && drafts.size === 0);
record("same_key_before_approval", { request: waitingReplay });

// 驱动模拟用户批准；保存仍走上一轮的执行器与原草稿工具，没有模型参与。
workflow.decideFromUser(first.requestId, "approve");
const saved = await workflow.execute(first.requestId);
check("first_approved_execution_saves_once", saved.status === "succeeded"
  && saved.toolResult?.ok === true && drafts.size === 1);
record("first_save", { request: saved });

// 假设调用方没收到成功回执，带原键和原正文重发：直接取回已保存的结果。
const replay = workflow.propose({ content }, idempotencyKey);
check("same_key_same_content_returns_original_result", JSON.stringify(replay) === JSON.stringify(saved));
record("same_key_after_success", { request: replay });
const repeatedExecution = await workflow.execute(replay.requestId);
check("executing_replayed_success_does_not_save_again", JSON.stringify(repeatedExecution) === JSON.stringify(saved)
  && drafts.size === 1);
record("execute_replayed_request", { request: repeatedExecution });

// 同键换正文会在 propose 内报冲突，尚未进入审批或保存；原请求与原草稿保留。
let conflict: { code: string; requestId: string; message: string } | undefined;
try {
  workflow.propose({ content: "项目周报：替换为另一份正文。" }, idempotencyKey);
} catch (error) {
  if (!(error instanceof IdempotencyConflictError)) throw error;
  conflict = { code: error.code, requestId: error.requestId, message: error.message };
}
check("same_key_different_content_reports_conflict", conflict?.code === "idempotency_conflict");
record("same_key_different_content", { error: conflict });
check("conflict_preserves_original_request_and_draft", JSON.stringify(workflow.get(first.requestId)) === JSON.stringify(saved)
  && drafts.size === 1 && [...drafts.values()][0] === content);

const destination = new URL(`../runs/idempotency-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
await mkdir(destination, { recursive: false });
await writeFile(new URL("result.json", destination), JSON.stringify({
  mode: "offline_program_demo", realModelCalls: 0, mockModelCalls: 0,
  decisionSource: "test driver simulates user approval; no model provides approval",
  idempotencyKey, content, checks, trace,
}, null, 2) + "\n", { flag: "wx" });
console.log(`PASS idempotency: checks=${checks.length}; model calls=0`);
console.log(`证据目录：${fileURLToPath(destination)}`);
