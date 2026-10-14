import { ToolNotFoundError, ToolRegistry } from "./tool-registry";
import { PermissionDeniedError, TemporaryToolError } from "./tool-errors";
import type { ToolCall, ToolMessage, ToolResult } from "./types";

export type ToolExecutionOptions = {
  signal?: AbortSignal;
};

// 串起来 ToolCall → 查找工具 → 校验参数 → 执行工具 → 包装成 ToolResult
// 执行工具的函数
export async function executeToolCall(
  // 到哪里找工具。
  registry: ToolRegistry,
  // 这次调用的 ID、工具名和参数。
  call: ToolCall,
  options: ToolExecutionOptions = {},
  // 返回的是完整 ToolResult。
): Promise<ToolResult> {
  // 执行前已收到取消：立即返回结构化错误，后面的查找、校验和工具执行均不发生。
  if (options.signal?.aborted) {
    return failure(call, "cancelled", "Tool execution was cancelled.", false);
  }

  let tool;

  // 根据 name 查找工具，找到就从注册表取出工具对象。
  try {
    tool = registry.require(call.name);
  } catch (error) {
    // 这里每个错误分支都有 return，所以查找失败就结束本次调用。
    if (error instanceof ToolNotFoundError) {
      return failure(call, "tool_not_found", error.message, false);
    }

    return failure(call, "execution_error", errorMessage(error), false);
  }

  let parsedArguments;

  // 校验参数
  try {
    parsedArguments = tool.parseArguments(call.arguments);
  } catch (error) {
    // 保留 Stage 3 的反馈语义：参数可修正后再调用，不表示原参数可以自动重试。
    return failure(call, "invalid_arguments", errorMessage(error), true);
  }

  // 执行工具，返回结构化 ToolResult
  try {
    // 信号继续传给工具，由工具在自己的取消检查点响应；传入信号不会自动撤销副作用。
    const output = await tool.execute(parsedArguments, options.signal);

    return {
      ok: true,
      toolCallId: call.id,
      toolName: call.name,
      output,
    };
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      return failure(call, "cancelled", "Tool execution was cancelled.", false);
    }

    if (error instanceof PermissionDeniedError) {
      return failure(call, "permission_denied", error.message, false);
    }
    if (error instanceof TemporaryToolError) {
      return failure(call, "temporary_unavailable", error.message, true);
    }
    // 未知异常不推定为暂时故障，避免盲目重复可能已经发生的写入。
    return failure(call, "execution_error", errorMessage(error), false);
  }
}

export function toolResultToMessage(result: ToolResult): ToolMessage {
  return {
    role: "tool",
    toolCallId: result.toolCallId,
    content: JSON.stringify(result),
  };
}

function failure(
  call: ToolCall,
  code: Extract<ToolResult, { ok: false }>["error"]["code"],
  message: string,
  retryable: boolean,
): ToolResult {
  return {
    ok: false,
    toolCallId: call.id,
    toolName: call.name,
    error: {
      code,
      message,
      retryable,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
