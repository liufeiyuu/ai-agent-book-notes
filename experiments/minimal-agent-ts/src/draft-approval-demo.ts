import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDraftWorkflow } from "./draft-workflow";
import { executeToolCall } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import { createDraftTool } from "./tools/create-draft";

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

// 改前对照：Stage 3 工具只检查正文是否合法，随后直接保存。
const baselineDrafts = new Map<string, string>();
const baseline = await executeToolCall(new ToolRegistry([createDraftTool(baselineDrafts)]), {
  id: "stage3-baseline", name: "create_draft", arguments: { content },
});
check("stage3_valid_input_writes_without_approval", baseline.ok && baselineDrafts.size === 1);
record("stage3_without_approval_gate", { result: baseline, draftCount: baselineDrafts.size });

// 改后：模型只能提出正文。此驱动模拟应用收到用户的审批输入。
// 下面固定输入并直接调用程序，没有真实模型或交互式审批界面参与。
const drafts = new Map<string, string>();
const workflow = createDraftWorkflow(drafts);
// 第一步：登记请求 A1 和正文，状态为 waiting_approval；drafts 仍为空。
const proposed = workflow.propose({ content });
record("proposed", { request: proposed, draftCount: drafts.size });
// 第二步：故意在未批准时执行，核对它直接返回等待状态，草稿数仍为 0。
const waiting = await workflow.execute(proposed.requestId);
check("unapproved_request_does_not_write", waiting.status === "waiting_approval" && drafts.size === 0);
record("execute_before_approval", { request: waiting, draftCount: drafts.size });

// 第三步：模拟用户批准 A1。批准只改状态为 approved，不会立即写入草稿。
const approved = workflow.decideFromUser(proposed.requestId, "approve");
check("approval_records_permission_before_execution", approved.status === "approved" && drafts.size === 0);
record("user_approved", { request: approved, draftCount: drafts.size });
// 再执行同一个 A1，才会保存已审批的正文：succeeded，草稿数从 0 变为 1。
const saved = await workflow.execute(proposed.requestId);
check("approved_request_saves_exact_content", saved.status === "succeeded"
  && drafts.size === 1 && [...drafts.values()][0] === content);
record("execute_after_approval", { request: saved, draftCount: drafts.size });

// 拒绝分支使用独立内存集合，避免把另一场景的已存草稿当成本次写入。
// 新工作流也从 A1 编号开始，但与上面的 A1 是两条独立请求。
const rejectedDrafts = new Map<string, string>();
const rejectedWorkflow = createDraftWorkflow(rejectedDrafts);
const rejectedProposal = rejectedWorkflow.propose({ content });
record("proposed_for_rejection", { request: rejectedProposal, draftCount: rejectedDrafts.size });
record("user_rejected", {
  request: rejectedWorkflow.decideFromUser(rejectedProposal.requestId, "reject"),
  draftCount: rejectedDrafts.size,
});
// 第四步：拒绝后仍尝试执行，核对状态保持 rejected，草稿数保持 0。
const rejected = await rejectedWorkflow.execute(rejectedProposal.requestId);
check("rejected_request_does_not_write", rejected.status === "rejected" && rejectedDrafts.size === 0);
record("execute_after_rejection", { request: rejected, draftCount: rejectedDrafts.size });

// 代表性错误：参数里自填 approved 并不是用户审批，propose 的参数校验会拒绝它。
// 这里沿用批准场景的集合，draftCount 为 1 是之前的草稿，没有产生第二份。
let forgedApprovalError = "";
try { workflow.propose({ content, approved: true }); }
catch (error) { forgedApprovalError = (error as Error).message; }
check("model_approval_field_is_rejected", forgedApprovalError.includes("Only content"));
record("model_supplied_approval_rejected", { error: forgedApprovalError, draftCount: drafts.size });

const destination = new URL(`../runs/approval-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url);
await mkdir(destination, { recursive: false });
await writeFile(new URL("result.json", destination), JSON.stringify({
  mode: "offline_program_demo", realModelCalls: 0, mockModelCalls: 0,
  decisionSource: "test driver simulates user approval; no model provides approval",
  content, checks, trace,
}, null, 2) + "\n", { flag: "wx" });
console.log(`PASS approval: checks=${checks.length}; model calls=0`);
console.log(`证据目录：${fileURLToPath(destination)}`);
