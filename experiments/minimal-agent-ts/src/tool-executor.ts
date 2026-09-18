import { ToolNotFoundError, ToolRegistry } from "./tool-registry";
import type { ToolCall, ToolMessage, ToolResult } from "./types";

export type ToolExecutionOptions = {
  signal?: AbortSignal;
};

// 执行工具的函数
export async function executeToolCall(
  registry: ToolRegistry,
  call: ToolCall,
  options: ToolExecutionOptions = {},
): Promise<ToolResult> {
  if (options.signal?.aborted) {
    return failure(call, "cancelled", "Tool execution was cancelled.", false);
  }

  let tool;

  // 根据 name 查找工具
  try {
    tool = registry.require(call.name);
  } catch (error) {
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
    return failure(call, "invalid_arguments", errorMessage(error), true);
  }

  // 执行工具，返回结构化 ToolResult
  try {
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
