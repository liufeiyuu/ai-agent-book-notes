export type JsonSchema = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  toolCalls: ToolCall[];
};

export type Message =
  | {
      role: "system" | "user";
      content: string;
    }
  | AssistantMessage
  | {
      role: "tool";
      toolCallId: string;
      content: string;
    };

export type ModelResponse = {
  message: AssistantMessage;
  finishReason: "stop" | "tool_calls" | "length";
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export interface Model {
  generate(input: {
    messages: Message[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  }): Promise<ModelResponse>;
}

export type ToolResult =
  | {
      ok: true;
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | {
      ok: false;
      toolCallId: string;
      toolName: string;
      error: {
        code: "invalid_arguments" | "timeout" | "execution_error";
        message: string;
        retryable: boolean;
      };
    };

export interface Tool<TArguments = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema; // model-facing: describes valid tool arguments.

  parseArguments(input: unknown): TArguments;

  // harness-facing: performs the real operation after argument validation.
  execute(
    arguments_: TArguments,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export type StopReason =
  | "final_response"
  | "max_turns"
  | "timeout"
  | "cancelled"
  | "model_error";

type Timestamped<TEvent> = TEvent & {
  timestamp: string;
};

export type TraceEvent =
  | Timestamped<{
      type: "model_request";
      turn: number;
      messages: Message[];
      tools: ToolDefinition[];
    }>
  | Timestamped<{
      type: "model_response";
      turn: number;
      response: ModelResponse;
    }>
  | Timestamped<{
      type: "tool_start";
      turn: number;
      call: ToolCall;
    }>
  | Timestamped<{
      type: "tool_end";
      turn: number;
      result: ToolResult;
    }>
  | Timestamped<{
      type: "run_stop";
      reason: StopReason;
    }>;

export type AgentRunResult = {
  completed: boolean;
  taskSuccess?: boolean; // evaluator-facing: unavailable without a task-specific rubric.
  stopReason: StopReason;
  turns: number;
  finalAnswer?: string;
  messages: Message[];
  trace: TraceEvent[];
};
