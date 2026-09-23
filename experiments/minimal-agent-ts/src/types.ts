// Record<string, unknown> 表示一个对象：键是字符串，值的类型暂不限定。
export type JsonSchema = Record<string, unknown>;

// 工具调用的类型
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

// 工具的使用说明。
export type ToolDefinition = {
  name: string;
  description: string;
  // 参数叫什么、是什么类型、哪些必填、有什么约束。
  inputSchema: JsonSchema;
};

export type ModelInput = {
  messages: Message[];
  tools: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  signal?: AbortSignal;
};

// 这段规定：任何符合 Model 接口的对象，都必须提供 generate 方法，接收上述输入，异步返回一个 ModelResponse。
export interface Model {
  generate(input: ModelInput): Promise<ModelResponse>;
}

// 一次调用结束后的统一反馈。
// 计算器的 execute 成功时只返回数字 2，外面的执行器再把它包装成整个 ToolResult。
// 同样，计算器抛出的除零异常，会由执行器捕获并整理成上述失败结果。
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

  // 检查收到的参数，返回经过校验的参数
  // 接收尚未验证的数据；如果校验通过，返回这个工具需要的参数类型。
  parseArguments(input: unknown): TArguments;

  // 使用这些参数，执行实际操作
  // 接收已经符合该参数类型的数据，异步执行并返回结果。
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

// 轮数按循环中的模型交互计算，工具事件不会单独增加一轮。
// messages 保存对话内容；
// trace 还记录请求、执行、拒绝、停止等过程，方便核对程序做过什么。
// 本实现不会把整份 Trace 自动作为对话发给模型。
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

// runAgent 返回给调用方的整次运行结果。
// 注意是返回给调用方，不是返回给模型。
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
