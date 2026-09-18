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
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): this {
    assertValidToolName(tool.name);

    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  // Registry 负责抛出错误；Harness 负责捕获并转换为失败的 Tool Result；Agent 通常继续下一轮，而不是直接终止。
  require(name: string): Tool {
    const tool = this.get(name);

    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    return tool;
  }

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
