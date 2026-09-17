import type { Client } from "@modelcontextprotocol/client";
import { calculator, type CalculatorArguments } from "../tools/calculator";
import type { Tool, ToolDefinition } from "../types";

type McpResult = Awaited<ReturnType<Client["callTool"]>>;

export function readCalculatorValue(result: McpResult): number {
  // 请求成功收到响应，不等于工具执行成功。
  if (result.isError) {
    const message = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text).join("\n");
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

// 专门适配本课计算器，不构建通用 MCP 框架。
export function createMcpCalculatorTool(
  client: Client,
  definition: ToolDefinition,
): Tool<CalculatorArguments> {
  if (definition.name !== "calculator") {
    throw new Error("Expected the discovered calculator tool.");
  }
  return {
    ...definition,
    parseArguments: (input) => calculator.parseArguments(input),
    async execute(args, signal): Promise<number> {
      const result = await client.callTool(
        { name: definition.name, arguments: args },
        signal ? { signal } : undefined,
      );
      // 返回纯业务数值；现有 executeToolCall 负责保留原调用 ID 并包装 ToolResult。
      return readCalculatorValue(result);
    },
  };
}
