// 用于后面生成草稿 ID
import { randomUUID } from "node:crypto";
import type { Tool } from "../types";

// 规定草稿工具的参数对象包含一个字符串字段 content，也就是正文。
type CreateDraftArguments = { content: string };

export function parseContent(input: unknown): string {
  if (typeof input !== "string") {
    throw new TypeError("content must be a string.");
  }
  if (input.trim().length === 0) {
    throw new TypeError("content must not be blank.");
  }
  // trim 只用于判空；有效正文保留原有空白。
  return input;
}

// 这个工具把正文保存到当前进程的内存中，返回草稿 ID。
// 草稿集合由程序提供，不是模型能传入的参数；只存在于当前进程。
// 这个函数接收一个草稿集合 drafts，返回一个符合 Tool 接口的工具对象，所以叫“工具工厂”。
export function createDraftTool(drafts: Map<string, string>): Tool<CreateDraftArguments> {
  return {
    name: "create_draft",
    description: "Save non-blank text as a new draft in this process's memory and return its ID. Preserve the original text, including surrounding whitespace.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          minLength: 1,
          pattern: "\\S",
          description: "Draft text containing at least one non-whitespace character.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },

    parseArguments(input: unknown): CreateDraftArguments {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new TypeError("Draft arguments must be an object.");
      }
      if (Object.keys(input).some((key) => key !== "content")) {
        throw new TypeError("Only content is allowed in draft arguments.");
      }
      return { content: parseContent((input as Record<string, unknown>).content) };
    },

    // 真正保存草稿的地方。
    // 参数中的 { content } 是解构，直接取出校验后的正文。
    async execute({ content }, signal): Promise<{ draftId: string }> {
      // 检查取消状态
      signal?.throwIfAborted();
      // 生成草稿 ID
      const draftId = randomUUID();
      // 保存 ID 与正文的对应关系
      drafts.set(draftId, content);
      // 返回草稿 ID
      return { draftId };
    },
  };
}
