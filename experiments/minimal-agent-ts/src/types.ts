export type JsonSchema = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  // Model output is untrusted until the Tool validates it.
  arguments: unknown;
};

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  toolCalls: ToolCall[];
};

export type ToolMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};

export type Message =
  | {
      role: "system" | "user";
      content: string;
    }
  | AssistantMessage
  | ToolMessage;

export type ModelResponse = {
  message: AssistantMessage;
  finishReason: "stop" | "tool_calls" | "length";
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type ModelInput = {
  messages: Message[];
  tools: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  signal?: AbortSignal;
};

export interface Model {
  generate(input: ModelInput): Promise<ModelResponse>;
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
        code:
          | "invalid_arguments"
          | "tool_not_found"
          | "timeout"
          | "cancelled"
          | "execution_error";
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
      toolChoice?: ModelInput["toolChoice"];
    }>
  | Timestamped<{
      type: "model_response";
      turn: number;
      response: ModelResponse;
    }>
  | Timestamped<{
      type: "final_rejected";
      turn: number;
      reason: string;
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
      error?: string;
    }>;

export type AgentRunResult = {
  completed: boolean;
  taskSuccess?: boolean; // evaluator-facing: unavailable without a task-specific rubric.
  stopReason: StopReason;
  turns: number;
  finalAnswer?: string;
  error?: string;
  messages: Message[];
  trace: TraceEvent[];
};
