import { executeToolCall } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import { createDraftTool } from "./tools/create-draft";
import type { ToolResult } from "./types";

// 审批与执行分成两个阶段：
// waiting_approval → approved → running → succeeded / failed / cancelled
// waiting_approval → rejected（本次请求结束，不进入工具执行）
type DraftStatus =
  | "waiting_approval" | "approved" | "rejected"
  | "running" | "succeeded" | "failed" | "cancelled";

export type DraftRequest = {
  requestId: string;
  idempotencyKey?: string;
  action: "create_draft";
  arguments: { content: string };
  status: DraftStatus;
  toolResult?: ToolResult;
};

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor(readonly idempotencyKey: string, readonly requestId: string) {
    super(`Idempotency key ${idempotencyKey} already belongs to request ${requestId} with different content.`);
    this.name = "IdempotencyConflictError";
  }
}

// Stage 4 的进程内补充实验：沿用 Stage 3 工具，在调用执行器前检查审批。
// requests 保存“准备做什么、是否获批”；drafts 保存真正执行后产生的草稿。
// 这个门槛只保护本工作流入口，直接调用原 create_draft 工具仍沿用 Stage 3 行为。
export function createDraftWorkflow(drafts: Map<string, string>) {
  const draftTool = createDraftTool(drafts);
  const registry = new ToolRegistry([draftTool]);
  const requests = new Map<string, DraftRequest>();
  // 调用方为同一次操作保留同一个键；重发时用它找回原请求，而不是另建 A2。
  // 只在这个工作流实例的内存中有效，不提供跨进程或重启后的去重。
  const requestIdByKey = new Map<string, string>();
  let nextRequest = 0;

  function requireRequest(requestId: string): DraftRequest {
    const request = requests.get(requestId);
    if (!request) throw new Error(`Unknown draft request: ${requestId}`);
    return request;
  }

  // 提议只登记待审批操作，不调用保存工具；参数按原工具的契约校验。
  // 键是应用侧的提交标识，独立于工具参数；省略键时保留每次新建请求的原行为。
  function propose(input: unknown, idempotencyKey?: string): DraftRequest {
    // 原契约只允许 content；夹带 approved: true 会在此抛错，不能自行取得许可。
    const args = draftTool.parseArguments(input);
    if (idempotencyKey !== undefined) {
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
        throw new TypeError("Idempotency key must be a non-blank string.");
      }
      const existingId = requestIdByKey.get(idempotencyKey);
      if (existingId !== undefined) {
        const existing = requireRequest(existingId);
        // 本工作流只有 create_draft + content，直接比较正文即可；空白也属于正文。
        // 同键换正文必须报冲突，不能覆盖原内容或把原审批套到另一份正文上。
        if (existing.arguments.content !== args.content) {
          throw new IdempotencyConflictError(idempotencyKey, existingId);
        }
        // 同键同正文：返回原请求当前状态及已有结果，不新建请求、不重置审批。
        return structuredClone(existing);
      }
    }
    const request: DraftRequest = {
      // A1 等编号标识审批请求；真正的 draftId 要等保存工具执行时才会生成。
      requestId: `A${++nextRequest}`,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      action: "create_draft",
      // 登记本次要批准的具体正文，之后执行时仍使用这份内容。
      arguments: { content: args.content },
      status: "waiting_approval",
    };
    requests.set(request.requestId, request);
    // 首次登记就绑定键，不等执行成功才登记，因此待审批的重发也会找到同一个请求。
    if (idempotencyKey !== undefined) requestIdByKey.set(idempotencyKey, request.requestId);
    // 返回副本；外部修改返回值的 status 或 content 不会改动内部待审批记录。
    return structuredClone(request);
  }

  // 只供应用接收用户审批后调用，不注册为模型工具，也不读取模型的 approved 字段。
  // 本实验由驱动模拟用户决定；函数自身没有身份认证，调用来源由应用负责约束。
  function decideFromUser(requestId: string, decision: "approve" | "reject"): DraftRequest {
    if (decision !== "approve" && decision !== "reject") {
      throw new TypeError("Decision must be approve or reject.");
    }
    const request = requireRequest(requestId);
    // 只允许对尚未决定的请求作决定；已拒绝的请求不能再在这里改成批准。
    if (request.status !== "waiting_approval") {
      throw new Error(`Request ${requestId} is no longer waiting for approval.`);
    }
    // approve 只记录执行许可，此时不会新增草稿；还要另行调用 execute。
    // reject 结束这次请求；之后即使调用 execute，也会被下面的状态判断挡住。
    request.status = decision === "approve" ? "approved" : "rejected";
    return structuredClone(request);
  }

  async function execute(requestId: string, signal?: AbortSignal): Promise<DraftRequest> {
    const request = requireRequest(requestId);
    // 核心判断：只有明确 approved 才会到达真正的保存工具。
    // waiting_approval：原样返回，保留等待状态；没有启动后台写入或在此挂起等人。
    // rejected：原样返回拒绝状态，不产生草稿；其他非 approved 状态也直接返回。
    // succeeded：连同 toolResult 返回原结果，不再调用保存工具；running 则返回进行中状态。
    if (request.status !== "approved") return structuredClone(request);

    // 获批后才进入执行阶段；running 表示正在处理，不能提前当作保存成功。
    request.status = "running";
    // 复用原调用链：查找工具 → 校验参数 → createDraftTool.execute → drafts.set。
    const result = await executeToolCall(registry, {
      id: `draft-${requestId}`,
      name: request.action,
      // 只使用审批请求里保存的正文，执行入口不接受一份新正文。
      arguments: structuredClone(request.arguments),
    }, signal === undefined ? {} : { signal });
    request.toolResult = result;
    // 工具返回成功后才标记 succeeded；执行器报告取消或其他错误则记相应终态。
    request.status = result.ok ? "succeeded"
      : result.error.code === "cancelled" ? "cancelled" : "failed";
    return structuredClone(request);
  }

  return {
    propose,
    decideFromUser,
    execute,
    // 查询同样返回副本；读取状态不授予调用方修改内部审批记录的能力。
    get: (requestId: string): DraftRequest => structuredClone(requireRequest(requestId)),
  };
}
