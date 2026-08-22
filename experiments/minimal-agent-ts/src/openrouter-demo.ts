import { mkdir, writeFile } from "node:fs/promises";

import { runAgent } from "./agent";
import { OpenRouterModel } from "./openrouter-model";
import { ToolRegistry } from "./tool-registry";
import { calculator } from "./tools/calculator";
import { currentTime } from "./tools/current-time";
import { createReadFileTool } from "./tools/read-file";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error(
    "Missing OPENROUTER_API_KEY. Export it before running this demo.",
  );
}

const modelName =
  process.env.OPENROUTER_MODEL ??
  process.env.MODEL_NAME ??
  "deepseek/deepseek-v4-flash";
const model = new OpenRouterModel({
  apiKey,
  model: modelName,
  appTitle: "minimal-agent-ts-learning-lab",
});
const readFileTool = createReadFileTool({
  rootDirectory: process.cwd(),
  maxBytes: 100_000,
});

const result = await runAgent({
  model,
  registry: new ToolRegistry([calculator, currentTime, readFileTool]),
  systemPrompt: [
    "You are a workspace assistant.",
    "Use read_file for file contents, current_time for the current time, and calculator for arithmetic.",
    "You must use all three tools to complete the user's three requested items.",
    "If a tool reports invalid arguments, correct them and try again.",
    "Return a concise final answer only after every requested item is complete.",
  ].join(" "),
  userInput: [
    "请完成三件事：",
    "1. 读取无敏感演示文件 fixtures/demo-project.json，告诉我项目的 name 和 version；",
    "2. 查询 Asia/Shanghai 当前时间；",
    "3. 计算 17 × 23。",
  ].join("\n"),
  maxTurns: 6,
  timeoutMs: 30_000,
});

const artifact = {
  model: modelName,
  run: result,
  providerExchanges: model.exchanges,
};
const outputDirectory = new URL("../runs/", import.meta.url);
const outputFile = new URL("latest-openrouter-run.json", outputDirectory);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  completed: result.completed,
  stopReason: result.stopReason,
  turns: result.turns,
  finalAnswer: result.finalAnswer,
  toolCalls: result.trace
    .filter((event) => event.type === "tool_start")
    .map((event) => event.call),
  traceFile: outputFile.pathname,
}, null, 2));
