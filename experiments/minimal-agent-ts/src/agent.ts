import { executeToolCall, toolResultToMessage } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import type {
  AgentRunResult,
  Message,
  Model,
  ModelInput,
  ModelResponse,
  StopReason,
  TraceEvent,
} from "./types";

export type RunAgentOptions = {
  model: Model;
  registry: ToolRegistry;
  systemPrompt: string;
  userInput: string;
  maxTurns: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  now?: () => string;
  // Task-specific constraints stay outside the reusable loop.
  prepareRequest?: (input: ModelInput) => ModelInput;
  validateFinal?: (response: ModelResponse) => string | undefined;
};

// runAgent 是 Harness，也是 Agent Loop 的核心。
// experiments/minimal-agent-ts/src/demo.ts 中调用
export async function runAgent(
  options: RunAgentOptions,
): Promise<AgentRunResult> {
  assertPositiveInteger(options.maxTurns, "maxTurns");
  if (options.timeoutMs !== undefined) {
    assertPositiveInteger(options.timeoutMs, "timeoutMs");
  }

  const messages: Message[] = [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: options.userInput },
  ];
  const trace: TraceEvent[] = [];
  const timestamp = options.now ?? (() => new Date().toISOString());
  const runAbort = createRunAbort(options.signal, options.timeoutMs);
  let turns = 0;

  const stop = (
    completed: boolean,
    reason: StopReason,
    details: { finalAnswer?: string; error?: string } = {},
  ): AgentRunResult => {
    trace.push({
      type: "run_stop",
      reason,
      timestamp: timestamp(),
      ...(details.error === undefined ? {} : { error: details.error }),
    });

    return {
      completed,
      stopReason: reason,
      turns,
      ...(details.finalAnswer === undefined
        ? {}
        : { finalAnswer: details.finalAnswer }),
      ...(details.error === undefined ? {} : { error: details.error }),
      messages,
      trace,
    };
  };

  try {
    for (let turn = 1; turn <= options.maxTurns; turn += 1) {
      if (runAbort.signal.aborted) {
        return stop(false, runAbort.stopReason());
      }

      turns = turn;
      // 这一轮传给 model 的 message
      // messages 是运行过程中累计的对话历史。这里复制一份，供本轮请求使用。
      const requestMessages = structuredClone(messages);
      // experiments/minimal-agent-ts/src/demo.ts Line 33
      // experiments/minimal-agent-ts/src/tool-registry.ts Line 13
      // 注册表的 definitions() 返回工具名称、说明和输入 Schema，再复制一份；实际执行方法仍留在注册表中。
      const toolDefinitions = structuredClone(options.registry.definitions());

      let request: ModelInput;
      try {
        const input: ModelInput = {
          messages: requestMessages,
          tools: toolDefinitions,
          signal: runAbort.signal,
        };
        const prepared = options.prepareRequest?.(input) ?? input;
        // A request hook may transform context and tools, but not detach cancellation.
        request = { ...prepared, signal: runAbort.signal };
      } catch (error) {
        return stop(false, "model_error", {
          error: `prepareRequest failed: ${errorMessage(error)}`,
        });
      }

      trace.push({
        type: "model_request",
        turn,
        messages: structuredClone(request.messages),
        tools: structuredClone(request.tools),
        ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
        timestamp: timestamp(),
      });

      let response;
      try {
        response = await raceWithAbort(
          // 调用模型
          // experiments/minimal-agent-ts/src/openrouter-demo.ts
          // experiments/minimal-agent-ts/src/mock-model.ts - L32
          // experiments/minimal-agent-ts/src/types.ts - L21
          options.model.generate(request),
          runAbort.signal,
        );
      } catch (error) {
        if (runAbort.signal.aborted || isAbortError(error)) {
          return stop(false, runAbort.stopReason());
        }

        return stop(false, "model_error", { error: errorMessage(error) });
      }

      trace.push({
        type: "model_response",
        turn,
        response: structuredClone(response),
        timestamp: timestamp(),
      });
      // Harness 首先把 assistant 的 Tool Call 保存进 Context
      messages.push(structuredClone(response.message));

      const toolCalls = response.message.toolCalls;

      // experiments/minimal-agent-ts/src/demo.ts 第二轮返回的 toolCalls 是空数组
      // runAgent 函数 return，Agent Loop 结束
      // return 的 stopReason 是告诉调用 runAgent 的这一方（比如服务端）循环结束原因，而不是告诉模型
      if (toolCalls.length === 0) {
        if (response.finishReason === "length") {
          return stop(false, "model_error", {
            error: "Model output was truncated before the task could finish.",
          });
        }

        if (response.message.content === null) {
          return stop(false, "model_error", {
            error: "Model returned neither text nor tool calls.",
          });
        }

        let rejection: string | undefined;
        try {
          rejection = options.validateFinal?.(structuredClone(response));
        } catch (error) {
          return stop(false, "model_error", {
            error: `validateFinal failed: ${errorMessage(error)}`,
          });
        }
        if (rejection !== undefined) {
          trace.push({
            type: "final_rejected",
            turn,
            reason: rejection,
            timestamp: timestamp(),
          });
          messages.push({ role: "system", content: rejection });
          continue;
        }

        // This is a protocol-level completion, not proof that the task is correct.
        return stop(true, "final_response", {
          finalAnswer: response.message.content,
        });
      }

      // 执行工具
      for (const call of toolCalls) {
        trace.push({
          type: "tool_start",
          turn,
          call: structuredClone(call),
          timestamp: timestamp(),
        });

        let result;
        try {
          result = await raceWithAbort(
            // experiments/minimal-agent-ts/src/tool-executor.ts
            executeToolCall(options.registry, call, {
              signal: runAbort.signal,
            }),
            runAbort.signal,
          );
        } catch (error) {
          if (runAbort.signal.aborted || isAbortError(error)) {
            return stop(false, runAbort.stopReason());
          }
          throw error;
        }

        trace.push({
          type: "tool_end",
          turn,
          result: structuredClone(result),
          timestamp: timestamp(),
        });
        // Agent Loop 把工具结果加入对话
        // 把 ToolResult 写回 message
        messages.push(toolResultToMessage(result));

        if (runAbort.signal.aborted) {
          return stop(false, runAbort.stopReason());
        }
      }
    }

    return stop(false, "max_turns");
  } finally {
    runAbort.dispose();
  }
}

type RunAbort = {
  signal: AbortSignal;
  stopReason(): Extract<StopReason, "timeout" | "cancelled">;
  dispose(): void;
};

function createRunAbort(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): RunAbort {
  const controller = new AbortController();
  let reason: Extract<StopReason, "timeout" | "cancelled"> = "cancelled";

  const abort = (nextReason: typeof reason): void => {
    if (!controller.signal.aborted) {
      reason = nextReason;
      controller.abort();
    }
  };

  const onExternalAbort = (): void => abort("cancelled");
  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => abort("timeout"), timeoutMs);

  return {
    signal: controller.signal,
    stopReason: () => reason,
    dispose(): void {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
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

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new RunAbortedError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RunAbortedError());
    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

class RunAbortedError extends Error {
  constructor() {
    super("Agent run was aborted.");
    this.name = "AbortError";
  }
}
