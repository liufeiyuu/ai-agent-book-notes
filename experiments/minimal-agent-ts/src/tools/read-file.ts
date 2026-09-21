// readFile：读取文件内容
// realpath：得到解析符号链接后的真实路径
// stat：查询文件类型、大小等信息
import { readFile, realpath, stat } from "node:fs/promises";
// isAbsolute：判断是否为绝对路径
// relative：计算目标相对于根目录的位置
// resolve：根据根目录和输入路径计算目标路径
import { isAbsolute, relative, resolve } from "node:path";

import type { Tool } from "../types";

// 每次调用传什么，这里只有文件路径 path。
export type ReadFileArguments = {
  path: string;
};

// 成功读取后返回什么，包括路径、字节数和正文。
export type ReadFileOutput = {
  path: string;
  bytes: number;
  content: string;
};

// 程序创建工具时设定的规则，包括允许读取的根目录和文件大小上限。
export type ReadFileToolOptions = {
  rootDirectory: string;
  maxBytes?: number;
};

// 工具工厂
export function createReadFileTool(
  options: ReadFileToolOptions,
): Tool<ReadFileArguments> {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("read_file maxBytes must be a positive integer.");
  }

  // 返回工具定义
  return {
    name: "read_file",
    description:
      "Read one UTF-8 text file inside the configured workspace. Absolute paths and parent-directory traversal are forbidden.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "A workspace-relative file path, for example package.json.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },

    // 检查输入
    parseArguments(input: unknown): ReadFileArguments {
      if (!isRecord(input)) {
        throw new TypeError("read_file arguments must be an object.");
      }
      if (typeof input.path !== "string" || input.path.trim() === "") {
        throw new TypeError("path must be a non-empty string.");
      }
      if (isAbsolute(input.path) || hasParentTraversal(input.path)) {
        throw new TypeError(
          "path must stay inside the workspace and cannot contain '..'.",
        );
      }

      return { path: input.path };
    },

    // 执行函数
    async execute(arguments_, signal): Promise<ReadFileOutput> {
      // 有取消信号且已经取消，就抛出异常，停止往下执行；没有传入信号，就跳过。
      signal?.throwIfAborted();

      const root = await realpath(options.rootDirectory);
      const candidate = resolve(root, arguments_.path);
      const target = await realpath(candidate);
      if (!isInside(root, target)) {
        throw new Error("Resolved file path escapes the configured workspace.");
      }

      const metadata = await stat(target);
      if (!metadata.isFile()) {
        throw new Error("Requested path is not a regular file.");
      }
      if (metadata.size > maxBytes) {
        throw new Error(
          `File is too large (${metadata.size} bytes); limit is ${maxBytes} bytes.`,
        );
      }

      signal?.throwIfAborted();
      return {
        path: arguments_.path,
        bytes: metadata.size,
        content: await readFile(target, "utf8"),
      };
    },
  };
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (
    !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot)
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
