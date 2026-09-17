import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { calculator } from "../tools/calculator";

const server = new McpServer({ name: "calculator-lab", version: "1.0.0" });

server.registerTool(calculator.name, {
  description: calculator.description,
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    left: z.number(),
    right: z.number(),
  }).strict(),
  outputSchema: z.object({ value: z.number() }),
}, async (input) => {
  // SDK 先校验协议参数；这里复用原工具的校验和计算逻辑。
  const args = calculator.parseArguments(input);
  console.error(JSON.stringify({ stage: "calculator.execute", arguments: args }));
  try {
    const value = await calculator.execute(args);
    const output = { value };
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
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
