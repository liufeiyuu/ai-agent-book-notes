import { randomUUID } from "node:crypto";
import type { Tool } from "../types";

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

// 草稿集合由程序提供，不是模型能传入的参数；只存在于当前进程。
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
    async execute({ content }, signal): Promise<{ draftId: string }> {
      signal?.throwIfAborted();
      const draftId = randomUUID();
      drafts.set(draftId, content);
      return { draftId };
    },
  };
}
