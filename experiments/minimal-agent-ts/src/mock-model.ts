import type {
  Message,
  Model,
  ModelInput,
  ModelResponse,
  ToolDefinition,
} from "./types";

export type RecordedModelRequest = {
  messages: Message[];
  tools: ToolDefinition[];
};

export type MockModelResponder = (
  input: ModelInput,
  requestIndex: number,
) => ModelResponse | Promise<ModelResponse>;


// MockModel 跳过了“真实 API + Adapter”，直接返回内部格式。
// Adapter 负责把服务商格式转换为 model 与 harness 约定通信的内部格式。
// 还需要一个尚未实现的 OpenRouterModel Adapter，把 API 格式转换成内部格式

export class MockModel implements Model {
  readonly requests: RecordedModelRequest[] = [];

  private responseIndex = 0;

  constructor(
    private readonly script: ModelResponse[] | MockModelResponder,
  ) {}

  async generate(input: ModelInput): Promise<ModelResponse> {
    input.signal?.throwIfAborted();

    this.requests.push({
      messages: structuredClone(input.messages),
      tools: structuredClone(input.tools),
    });

    const requestIndex = this.responseIndex++;
    const response = Array.isArray(this.script)
      ? this.script[requestIndex]
      : await this.script(input, requestIndex);

    if (!response) {
      throw new Error(`MockModel has no response for request ${requestIndex + 1}.`);
    }

    return structuredClone(response);
  }
}
