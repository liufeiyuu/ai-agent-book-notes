import assert from "node:assert/strict";
import test from "node:test";

import { createReadFileTool } from "../src/tools/read-file";

const tool = createReadFileTool({
  rootDirectory: process.cwd(),
  maxBytes: 100_000,
});

test("reads a UTF-8 file inside the configured workspace", async () => {
  const arguments_ = tool.parseArguments({ path: "package.json" });
  const output = await tool.execute(arguments_);

  assert.equal(typeof output, "object");
  if (typeof output === "object" && output !== null && "content" in output) {
    const parsed = JSON.parse(String(output.content)) as { name: string };
    assert.equal(parsed.name, "minimal-agent-ts");
  }
});

test("rejects parent-directory traversal before execution", () => {
  assert.throws(
    () => tool.parseArguments({ path: "../secret.txt" }),
    /cannot contain '\.\.'/,
  );
});

test("rejects absolute paths before execution", () => {
  assert.throws(
    () => tool.parseArguments({ path: "/etc/passwd" }),
    /stay inside the workspace/,
  );
});

test("fails during execution when the file does not exist", async () => {
  const arguments_ = tool.parseArguments({ path: "does-not-exist.txt" });

  await assert.rejects(tool.execute(arguments_), /ENOENT/);
});
