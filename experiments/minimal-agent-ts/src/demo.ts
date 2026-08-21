import { runAgent } from "./agent";
import { MockModel } from "./mock-model";
import { ToolRegistry } from "./tool-registry";
import { calculator } from "./tools/calculator";

const model = new MockModel([
  {
    finishReason: "tool_calls",
    message: {
      role: "assistant",
      content: null,
      toolCalls: [
        {
          id: "call-add",
          name: "calculator",
          arguments: { operation: "add", left: 20, right: 22 },
        },
      ],
    },
  },
  {
    finishReason: "stop",
    message: {
      role: "assistant",
      content: "20 + 22 = 42",
      toolCalls: [],
    },
  },
]);

const result = await runAgent({
  model,
  registry: new ToolRegistry([calculator]),
  systemPrompt: "Use tools when calculation is required.",
  userInput: "What is 20 + 22?",
  maxTurns: 3,
  timeoutMs: 1_000,
});

console.log(JSON.stringify(result, null, 2));
