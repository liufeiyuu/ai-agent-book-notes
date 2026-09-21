// 这个文件做的事情是：把已有计算器接到 MCP 上，让另一个进程里的 Client 能发现它、调用它并收到结果。

// 创建服务端，注册可调用工具
import { McpServer } from "@modelcontextprotocol/server";

// 通过标准输入、标准输出收发协议消息
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// 描述并校验输入输出的数据结构
import { z } from "zod";

// 计算器工具
import { calculator } from "../tools/calculator";

// 创建 Server
const server = new McpServer({ name: "calculator-lab", version: "1.0.0" });

// 注册计算器
// 可以把这次注册拆成三部分：
// 工具名称 → 工具说明与输入输出约束 → 收到调用后执行的回调
server.registerTool(calculator.name, {
  description: calculator.description,
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    left: z.number(),
    right: z.number(),
  }).strict(),
  outputSchema: z.object({ value: z.number() }),
}, async (input) => {

  // SDK 先按注册的输入 Schema 校验，回调里再复用原计算器的 parseArguments
  const args = calculator.parseArguments(input);
  console.error(JSON.stringify({ stage: "calculator.execute", arguments: args }));

  // “结果怎样回到 Agent”问题：
  // 此处先生成 MCP 返回结果，后面的应用适配层还要把它转成我们自己的 ToolResult
  try {
    const value = await calculator.execute(args);
    const output = { value };
    // 同一个 output 被放进两个位置
    // 它们表达的是同一次计算结果：文本内容方便文本消费者读取，结构化内容让程序直接读取 value。
    return {
      // JSON 字符串
      content: [{ type: "text", text: JSON.stringify(output) }],
      // 结构化对象
      structuredContent: output,
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
});

// stdout 只传 MCP 消息；教学日志写到 stderr。
await server.connect(new StdioServerTransport());

// 这个实验通过进程的输入输出通信：
// Client 发出的协议消息 → Server 的 stdin
// Server 返回的协议消息 → Server 的 stdout
// 教学日志              → Server 的 stderr
// 因此前面使用 console.error 写日志。若改成 console.log，普通日志就可能混入承载协议消息的 stdout，干扰 Client 解析。