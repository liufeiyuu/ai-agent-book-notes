import type { Client } from "@modelcontextprotocol/client";
import { calculator, type CalculatorArguments } from "../tools/calculator";
import type { Tool, ToolDefinition } from "../types";

type McpResult = Awaited<ReturnType<Client["callTool"]>>;

// 检查已经收到的 MCP 结果，成功时取出数字，失败时抛出异常，交给已有执行器处理。
export function readCalculatorValue(result: McpResult): number {
  // 请Client 收到了响应，不代表计算成功。
  if (result.isError) {
    const message = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text).join("\n");

    // 一旦执行 throw，函数立即退出，不会继续读取成功结果。
    throw new Error(message || "MCP calculator failed.");
  }
  const output = result.structuredContent;
  const value = typeof output === "object" && output !== null && "value" in output
    ? output.value : undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("MCP calculator must return a finite structuredContent.value.");
  }
  return value;
}


// readCalculatorValue 负责读取结果。
// 这个工厂函数把它接进完整工具：让已有执行器可以通过本地 Tool 接口，调用 MCP Server 上的计算器。
export function createMcpCalculatorTool(
  // 前面已经连接好的 MCP Client。
  client: Client,
  // 发现工具后整理出的名称、描述和输入 Schema。
  definition: ToolDefinition,
): Tool<CalculatorArguments> {

  // 这个适配器专门处理计算器，后面的参数校验和结果读取都按照计算器约定实现。如果传入其他工具的定义，就在创建阶段拒绝。
  if (definition.name !== "calculator") {
    throw new Error("Expected the discovered calculator tool.");
  }

  // 返回工具对象
  return {
    ...definition,

    // 运行工厂函数时，只创建对象，不会立即执行这两个方法。
    // 返回的方法仍能访问传入的 client 和 definition，这是闭包在这里的作用。
    parseArguments: (input) => calculator.parseArguments(input),

    async execute(args, signal): Promise<number> {
      // 这里没有直接调用本地的 calculator.execute()。
      // 请求经过 MCP Client 发给 Server，由 Server 调用实际的计算器实现。
      const result = await client.callTool(
        { name: definition.name, arguments: args },
        signal ? { signal } : undefined,
      );
      // 返回纯业务数值；现有 executeToolCall 负责保留原调用 ID 并包装 ToolResult。
      return readCalculatorValue(result);
    },
  };
}
