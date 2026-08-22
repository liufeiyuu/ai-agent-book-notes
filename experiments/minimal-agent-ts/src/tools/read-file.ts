import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { Tool } from "../types";

export type ReadFileArguments = {
  path: string;
};

export type ReadFileOutput = {
  path: string;
  bytes: number;
  content: string;
};

export type ReadFileToolOptions = {
  rootDirectory: string;
  maxBytes?: number;
};

export function createReadFileTool(
  options: ReadFileToolOptions,
): Tool<ReadFileArguments> {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("read_file maxBytes must be a positive integer.");
  }

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

    async execute(arguments_, signal): Promise<ReadFileOutput> {
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
