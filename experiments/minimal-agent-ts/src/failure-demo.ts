import { mkdir, writeFile } from "node:fs/promises";

import { runAgent } from "./agent";
import { MockModel } from "./mock-model";
import { ToolRegistry } from "./tool-registry";
import { calculator } from "./tools/calculator";
import { createCurrentTimeTool } from "./tools/current-time";
import { createReadFileTool } from "./tools/read-file";
import type { AgentRunResult, ModelResponse, ToolCall } from "./types";

const registry = new ToolRegistry([
  calculator,
  createCurrentTimeTool({
    now: () => new Date("2026-08-22T00:00:00.000Z"),
  }),
  createReadFileTool({ rootDirectory: process.cwd(), maxBytes: 100_000 }),
]);

const scenarios: Record<string, AgentRunResult> = {};

scenarios.unknownTool = await run([
  toolResponse(call("unknown-1", "weather", { city: "Shanghai" })),
  finalResponse("weather 不存在，无法查询天气。"),
]);

scenarios.invalidArgumentsThenRecovery = await run([
  toolResponse(call("time-bad", "current_time", {})),
  toolResponse(call("time-fixed", "current_time", {
    timeZone: "Asia/Shanghai",
  })),
  finalResponse("上海时间查询成功。"),
]);

scenarios.executionFailure = await run([
  toolResponse(call("file-missing", "read_file", {
    path: "does-not-exist.txt",
  })),
  finalResponse("文件不存在，无法读取。"),
]);

const repeatingModel = new MockModel((_input, requestIndex) =>
  toolResponse(call(`repeat-${requestIndex + 1}`, "calculator", {
    operation: "add",
    left: requestIndex,
    right: 1,
  })),
);
scenarios.maxTurns = await runAgent({
  model: repeatingModel,
  registry,
  systemPrompt: "Keep requesting a calculation.",
  userInput: "Demonstrate maxTurns.",
  maxTurns: 2,
});

const outputDirectory = new URL("../runs/", import.meta.url);
const outputFile = new URL("failure-scenarios.json", outputDirectory);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(scenarios, null, 2)}\n`, "utf8");

console.log(JSON.stringify(
  Object.fromEntries(
    Object.entries(scenarios).map(([name, result]) => [
      name,
      {
        completed: result.completed,
        stopReason: result.stopReason,
        turns: result.turns,
        toolResults: result.trace
          .filter((event) => event.type === "tool_end")
          .map((event) => event.result),
      },
    ]),
  ),
  null,
  2,
));
console.log(`Full traces: ${outputFile.pathname}`);

function run(responses: ModelResponse[]): Promise<AgentRunResult> {
  return runAgent({
    model: new MockModel(responses),
    registry,
    systemPrompt: "Use tools and react to structured tool errors.",
    userInput: "Complete the scenario.",
    maxTurns: 4,
  });
}

function call(
  id: string,
  name: string,
  arguments_: unknown,
): ToolCall {
  return { id, name, arguments: arguments_ };
}

function toolResponse(...toolCalls: ToolCall[]): ModelResponse {
  return {
    finishReason: "tool_calls",
    message: { role: "assistant", content: null, toolCalls },
  };
}

function finalResponse(content: string): ModelResponse {
  return {
    finishReason: "stop",
    message: { role: "assistant", content, toolCalls: [] },
  };
}
