import type {
  AssistantMessage,
  JsonSchema,
  Message,
  Model,
  ModelInput,
  ModelResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenRouterModelOptions = {
  apiKey: string;
  model: string;
  endpoint?: string;
  siteUrl?: string;
  appTitle?: string;
  fetch?: FetchLike;
};

export type OpenRouterExchange = {
  request: OpenRouterRequest;
  responseStatus: number;
  responseBody: unknown;
};

export class OpenRouterModel implements Model {
  readonly exchanges: OpenRouterExchange[] = [];

  private readonly endpoint: string;
  private readonly fetch_: FetchLike;

  constructor(private readonly options: OpenRouterModelOptions) {
    if (options.apiKey.trim() === "") {
      throw new TypeError("OpenRouter apiKey must not be empty.");
    }
    if (options.model.trim() === "") {
      throw new TypeError("OpenRouter model must not be empty.");
    }

    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetch_ = options.fetch ?? fetch;
  }

  // 调用真实模型请求
  async generate(input: ModelInput): Promise<ModelResponse> {
    input.signal?.throwIfAborted();

    const request = toOpenRouterRequest(this.options.model, input);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.options.siteUrl !== undefined) {
      headers["HTTP-Referer"] = this.options.siteUrl;
    }
    if (this.options.appTitle !== undefined) {
      headers["X-OpenRouter-Title"] = this.options.appTitle;
    }

    const response = await this.fetch_(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const responseBody = await readJsonResponse(response);

    // The authorization header is deliberately not captured.
    this.exchanges.push({
      request: structuredClone(request),
      responseStatus: response.status,
      responseBody: structuredClone(responseBody),
    });

    if (!response.ok) {
      throw new OpenRouterApiError(
        response.status,
        readApiErrorMessage(responseBody),
      );
    }

    return parseOpenRouterResponse(responseBody);
  }
}

export class OpenRouterApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`OpenRouter request failed (${status}): ${message}`);
    this.name = "OpenRouterApiError";
  }
}

export type OpenRouterRequest = {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  tool_choice?: "auto" | "required" | "none";
};

type OpenRouterMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenRouterTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

// 内部格式转换成 openrouter 请求
export function toOpenRouterRequest(
  model: string,
  input: Pick<ModelInput, "messages" | "tools" | "toolChoice">,
): OpenRouterRequest {
  const messages = input.messages.map(toOpenRouterMessage);
  const tools = input.tools.map(toOpenRouterTool);

  return {
    model,
    messages,
    ...(tools.length === 0 ? {} : { tools }),
    ...(input.toolChoice !== undefined
      ? { tool_choice: input.toolChoice }
      : tools.length === 0 ? {} : { tool_choice: "auto" as const }),
  };
}

// openrouter 响应转换为内部格式
export function parseOpenRouterResponse(input: unknown): ModelResponse {
  const root = requireRecord(input, "response");
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    throw new TypeError("OpenRouter response.choices must be a non-empty array.");
  }

  const choice = requireRecord(root.choices[0], "response.choices[0]");
  const rawMessage = requireRecord(
    choice.message,
    "response.choices[0].message",
  );
  const rawToolCalls = rawMessage.tool_calls ?? [];
  if (!Array.isArray(rawToolCalls)) {
    throw new TypeError("OpenRouter message.tool_calls must be an array.");
  }

  const toolCalls = rawToolCalls.map(parseToolCall);
  const content = rawMessage.content;
  if (content !== null && content !== undefined && typeof content !== "string") {
    throw new TypeError("OpenRouter assistant content must be a string or null.");
  }

  const message: AssistantMessage = {
    role: "assistant",
    content: content ?? null,
    toolCalls,
  };

  return {
    message,
    finishReason: parseFinishReason(choice.finish_reason, toolCalls.length),
  };
}

function toOpenRouterMessage(message: Message): OpenRouterMessage {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant": {
      const toolCalls = message.toolCalls.map(toOpenRouterToolCall);
      return {
        role: "assistant",
        content: message.content,
        ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
      };
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function toOpenRouterToolCall(call: ToolCall): OpenRouterToolCall {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments:
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments),
    },
  };
}

function toOpenRouterTool(definition: ToolDefinition): OpenRouterTool {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

function parseToolCall(input: unknown, index: number): ToolCall {
  const call = requireRecord(input, `tool_calls[${index}]`);
  const function_ = requireRecord(
    call.function,
    `tool_calls[${index}].function`,
  );
  const id = requireString(call.id, `tool_calls[${index}].id`);
  const name = requireString(
    function_.name,
    `tool_calls[${index}].function.name`,
  );
  const rawArguments = requireString(
    function_.arguments,
    `tool_calls[${index}].function.arguments`,
  );

  return {
    id,
    name,
    arguments: parseArguments(rawArguments),
  };
}

function parseArguments(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    // Keep malformed model output untrusted. Tool.parseArguments will reject it
    // and the Harness can return an invalid_arguments Tool Result.
    return input;
  }
}

function parseFinishReason(
  input: unknown,
  toolCallCount: number,
): ModelResponse["finishReason"] {
  if (toolCallCount > 0) {
    return "tool_calls";
  }
  if (input === "stop") {
    return "stop";
  }
  if (input === "length") {
    return "length";
  }

  throw new TypeError(`Unsupported OpenRouter finish_reason: ${String(input)}.`);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("OpenRouter returned a non-JSON response.");
  }
}

function readApiErrorMessage(input: unknown): string {
  if (isRecord(input) && isRecord(input.error)) {
    const message = input.error.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown API error";
}

function requireRecord(input: unknown, path: string): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return input;
}

function requireString(input: unknown, path: string): string {
  if (typeof input !== "string" || input === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
