// Tool 包含校验和执行函数，供本地程序使用；
// ToolDefinition 只有名称、描述和 Schema，供模型了解工具。
import type { Tool, ToolDefinition } from "./types";

export class ToolNotFoundError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = "ToolNotFoundError";
    this.toolName = toolName;
  }
}

// 管理工具的注册表
// 注册表负责保存工具、按名称查找工具，以及导出工具说明。
export class ToolRegistry {
  // 将工具存进注册表
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  // 注册函数
  register(tool: Tool): this {
    assertValidToolName(tool.name);

    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
    return this;
  }

  // get 直接查询 Map，找不到就返回 undefined。
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  // Registry 负责抛出错误；Harness 负责捕获并转换为失败的 Tool Result；Agent 通常继续下一轮，而不是直接终止。
  // require 在查询之后增加一道检查：找不到就抛错，因此正常返回时一定有工具。
  require(name: string): Tool {
    const tool = this.get(name);

    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    return tool;
  }

  // 生成给模型的工具说明
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }),
    );
  }
}

function assertValidToolName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error(
      `Invalid tool name "${name}". Use letters, numbers, underscores, or hyphens.`,
    );
  }
}
