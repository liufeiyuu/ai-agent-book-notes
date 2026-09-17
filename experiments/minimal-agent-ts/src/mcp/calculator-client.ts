import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runAgent } from "../agent";
import { MockModel } from "../mock-model";
import { ToolRegistry } from "../tool-registry";
import type { ToolResult } from "../types";
import { createMcpCalculatorTool } from "./calculator-adapter";

type WireMessage = Parameters<StdioClientTransport["send"]>[0];
const messages: { direction: string; message: WireMessage }[] = [];

// 只旁路记录 SDK 实际收发的消息，不自行实现协议。
class RecordingTransport extends StdioClientTransport {
  override async start(): Promise<void> {
    const receive = this.onmessage;
    this.onmessage = (message) => {
      messages.push({ direction: "server → client", message });
      receive?.(message);
    };
    await super.start();
  }
  override async send(message: WireMessage): Promise<void> {
    messages.push({ direction: "client → server", message });
    await super.send(message);
  }
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const transport = new RecordingTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/calculator-server.ts"],
  cwd: projectRoot,
  stderr: "pipe",
});
let serverLog = "";
transport.stderr?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });
const client = new Client({ name: "calculator-lesson-client", version: "1.0.0" });
const watchdog = setTimeout(() => {
  console.error("MCP lesson exceeded 20 seconds.");
  void client.close().finally(() => { process.exitCode = 1; });
}, 20_000);

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["calculator"]);

  const cases = [
    { label: "valid", input: { operation: "divide", left: 6, right: 3 } },
    { label: "invalid-type", input: { operation: "divide", left: 6, right: "3" } },
    { label: "divide-by-zero", input: { operation: "divide", left: 6, right: 0 } },
  ];
  const results = [];
  for (const { label, input } of cases) {
    const result = await client.callTool({ name: "calculator", arguments: input });
    if (label === "valid") {
      assert.notEqual(result.isError, true);
      assert.deepEqual(result.structuredContent, { value: 2 });
      assert.deepEqual(result.content, [{ type: "text", text: '{"value":2}' }]);
    } else {
      assert.equal(result.isError, true);
      if (label === "divide-by-zero") {
        assert.deepEqual(result.content, [{ type: "text", text: "Cannot divide by zero." }]);
      }
    }
    results.push({ label, input, result });
  }

  const discovered = listed.tools[0]!;
  assert.ok(discovered.outputSchema);
  const registry = new ToolRegistry([createMcpCalculatorTool(client, {
    name: discovered.name,
    description: discovered.description ?? "",
    inputSchema: discovered.inputSchema,
  })]);
  const loopRuns = [];
  for (const right of [3, 0]) {
    const callId = right === 3 ? "loop-valid" : "loop-error";
    const model = new MockModel((input, index) => {
      if (index === 0) {
        assert.equal(input.tools[0]?.name, discovered.name);
        return {
          finishReason: "tool_calls",
          message: { role: "assistant", content: null, toolCalls: [{
            id: callId, name: discovered.name,
            arguments: { operation: "divide", left: 6, right },
          }] },
        };
      }
      // 检查 MockModel.generate 实际收到的第二轮输入，不只检查终端日志。
      const message = input.messages.at(-1);
      assert.equal(message?.role, "tool");
      if (message?.role !== "tool") throw new Error("Missing tool message.");
      assert.equal(message.toolCallId, callId);
      const result = JSON.parse(message.content) as ToolResult;
      assert.equal(result.toolCallId, callId);
      assert.equal(result.toolName, "calculator");
      if (right === 3) {
        assert.equal(result.ok, true);
        assert.equal(result.output, 2);
      } else {
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "execution_error");
        assert.equal(result.error.message, "Cannot divide by zero.");
      }
      return {
        finishReason: "stop",
        message: { role: "assistant", toolCalls: [],
          content: result.ok ? `计算结果：${result.output}` : `计算失败：${result.error.message}` },
      };
    });
    const run = await runAgent({
      model, registry, systemPrompt: "离线 MCP 链路测试。",
      userInput: `计算 6 / ${right}`, maxTurns: 2, timeoutMs: 5_000,
    });
    assert.equal(run.completed, true, JSON.stringify(run));
    assert.equal(model.requests.length, 2);
    loopRuns.push({ callId, modelKind: "MockModel (offline)", modelRequests: model.requests, run });
  }
  await client.close();
  const sentMethods = messages.flatMap(({ direction, message }) =>
    direction === "client → server" && "method" in message ? [message.method] : []);
  assert.deepEqual(sentMethods.slice(0, 3), ["initialize", "notifications/initialized", "tools/list"]);
  const executed = serverLog.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(executed.map((event) => event.arguments.right), [3, 0, 3, 0]);

  const record = {
    recordedAt: new Date().toISOString(),
    modelCalls: 0,
    transport: "stdio", sdkVersion: "2.0.0",
    tools: listed.tools, results, messages, executed, loopRuns,
  };
  const output = new URL("../../artifacts/mcp-calculator-latest.json", import.meta.url);
  await mkdir(new URL(".", output), { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ methods: sentMethods, results, executed,
    loopRuns: loopRuns.map(({ callId, modelRequests, run }) => ({
      callId, secondRequestToolMessage: modelRequests[1]?.messages.at(-1),
      finalAnswer: run.finalAnswer,
    })), record: fileURLToPath(output) }, null, 2));
} finally {
  clearTimeout(watchdog);
  await client.close();
}
