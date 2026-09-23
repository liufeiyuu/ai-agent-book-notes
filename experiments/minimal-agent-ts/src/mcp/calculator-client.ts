// 检查发现结果、调用结果和消息顺序
import assert from "node:assert/strict";
// 保存运行记录
import { mkdir, writeFile } from "node:fs/promises";
// 把文件 URL 转为文件系统路径
import { fileURLToPath } from "node:url";
// 连接 Server、发现和调用工具
import { Client } from "@modelcontextprotocol/client";
// 启动 Server 子进程，通过 stdio 通信
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
// 后半段验证结果进入 Agent Loop 的链路
import { runAgent } from "../agent";
import { MockModel } from "../mock-model";
// 复用已有工具注册和结果类型
import { ToolRegistry } from "../tool-registry";
import type { ToolResult } from "../types";
// 把 MCP 计算器接到我们已有的工具接口上
import { createMcpCalculatorTool } from "./calculator-adapter";

// WireMessage 就是“SDK 的 send 方法接收的消息类型”
type WireMessage = Parameters<StdioClientTransport["send"]>[0];

// messages 保存的是 Client 与 Server 之间的 MCP 协议消息
const messages: { direction: string; message: WireMessage }[] = [];

// 在 SDK 收发 MCP 消息时记下记录，并让消息继续进入原来的处理流程。
// 记录传输类
class RecordingTransport extends StdioClientTransport {
  override async start(): Promise<void> {
    // 首先，保存原来的接收处理函数
    const receive = this.onmessage;
    // 然后，把 onmessage 换成一个包装函数
    // 以后每当收到消息，就先记入数组，再调用原来的 receive

    //   收到 Server 消息
    //     ↓
    // 记录 direction 和 message
    //     ↓
    // 交给原来的接收处理函数

    // 保存并调用原函数非常关键。 如果这里只记录，却没有继续转交，SDK 就无法通过原接收流程处理响应，等待结果的调用可能一直等不到完成。
    this.onmessage = (message) => {
      messages.push({ direction: "server → client", message });
      receive?.(message);
    };

    // super.start() 调用父类原有的启动逻辑。
    // 因此顺序是：先装好记录回调，再启动传输，便于记录启动后收到的消息。
    await super.start();
  }

  //   准备发送消息
  //   ↓
  // 记入 messages 数组
  //   ↓
  // 调用父类 send，执行实际发送
  override async send(message: WireMessage): Promise<void> {
    messages.push({ direction: "client → server", message });
    await super.send(message);
  }
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

// 创建传输对象
const transport = new RecordingTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/calculator-server.ts"],
  cwd: projectRoot,
  stderr: "pipe",
});

// 接收 Server 日志，Server 写入 stderr 的教学日志
let serverLog = "";
transport.stderr?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });

// 创建 client，负责协议交互的客户端
const client = new Client({ name: "calculator-lesson-client", version: "1.0.0" });

// 设置演示超时保护
const watchdog = setTimeout(() => {
  console.error("MCP lesson exceeded 20 seconds.");
  void client.close().finally(() => { process.exitCode = 1; });
}, 20_000);


// 连接与工具发现
try {
  // 把 Client 与传输对象接起来
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

    // callTool() 请求执行工具

    //   Client.callTool
    // → 通过 stdio 发送 tools/call 请求
    // → Server 校验参数并调用工具
    // → Server 返回 MCP 结果
    // → Client 得到 result

    // 此处的 result 仍然是 MCP 返回格式；转换成我们 Agent 使用的 ToolResult，是后面适配层的工作。
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

  // 先取出发现的工具定义。
  // discovered 是 Server 提供的计算器说明，包含名称、描述、输入 Schema、输出 Schema 等数据。
  // 这里并没有把 Server 的计算器函数传过来。发现工具得到的是说明，执行时仍要通过 Client 发请求。
  const discovered = listed.tools[0]!;
  assert.ok(discovered.outputSchema);

  // 先创建符合我们本地 Tool 接口的工具对象，再把它交给注册表。
  // 执行到 new ToolRegistry(...) 时，只是完成注册，还没有发起一次新的计算请求。
  const registry = new ToolRegistry([createMcpCalculatorTool(client, {
    name: discovered.name,
    description: discovered.description ?? "",
    inputSchema: discovered.inputSchema,
  })]);

  // 用这个注册表的两组 Agent Loop 测试。
  // 这段代码验证：Agent 提出计算请求后，MCP 的成功结果或错误，能否进入下一轮模型输入。
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

  // 程序等待 Client 关闭连接
  await client.close();

  // 从完整消息记录中提取发出的方法名。
  // 只看 Client 发给 Server 的消息。 && 消息中存在 method 字段，才提取它。
  // 检查 messages、serverLog 是否符合预期
  const sentMethods = messages.flatMap(({ direction, message }) =>
    direction === "client → server" && "method" in message ? [message.method] : []);
  assert.deepEqual(sentMethods.slice(0, 3), ["initialize", "notifications/initialized", "tools/list"]);
  const executed = serverLog.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(executed.map((event) => event.arguments.right), [3, 0, 3, 0]);

  // 前面已经完成调用和检查，现在要把证据保存下来，再清理资源。
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
