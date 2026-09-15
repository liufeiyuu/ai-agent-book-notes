import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

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
      assert.deepEqual(result.content, [{ type: "text", text: "2" }]);
    } else {
      assert.equal(result.isError, true);
      if (label === "divide-by-zero") {
        assert.deepEqual(result.content, [{ type: "text", text: "Cannot divide by zero." }]);
      }
    }
    results.push({ label, input, result });
  }
  await client.close();
  const sentMethods = messages.flatMap(({ direction, message }) =>
    direction === "client → server" && "method" in message ? [message.method] : []);
  assert.deepEqual(sentMethods.slice(0, 3), ["initialize", "notifications/initialized", "tools/list"]);
  const executed = serverLog.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(executed.map((event) => event.arguments.right), [3, 0]);

  const record = {
    recordedAt: new Date().toISOString(),
    modelCalls: 0,
    transport: "stdio", sdkVersion: "2.0.0",
    tools: listed.tools, results, messages, executed,
  };
  const output = new URL("../../artifacts/mcp-calculator-latest.json", import.meta.url);
  await mkdir(new URL(".", output), { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ methods: sentMethods, results, executed, record: fileURLToPath(output) }, null, 2));
} finally {
  clearTimeout(watchdog);
  await client.close();
}
