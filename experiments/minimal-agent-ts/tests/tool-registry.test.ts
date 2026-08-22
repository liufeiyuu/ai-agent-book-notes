import assert from "node:assert/strict";
import test from "node:test";

import { ToolNotFoundError, ToolRegistry } from "../src/tool-registry";
import { calculator } from "../src/tools/calculator";

test("registers a tool and exposes only its model-facing definition", () => {
  const registry = new ToolRegistry([calculator]);

  assert.equal(registry.require("calculator"), calculator);
  assert.deepEqual(registry.definitions(), [
    {
      name: calculator.name,
      description: calculator.description,
      inputSchema: calculator.inputSchema,
    },
  ]);
  assert.equal("execute" in registry.definitions()[0]!, false);
});

test("rejects duplicate tool names", () => {
  const registry = new ToolRegistry([calculator]);

  assert.throws(
    () => registry.register(calculator),
    /Tool already registered: calculator/,
  );
});

test("reports an unknown tool with a typed error", () => {
  const registry = new ToolRegistry();

  assert.throws(
    () => registry.require("missing_tool"),
    (error) =>
      error instanceof ToolNotFoundError &&
      error.toolName === "missing_tool",
  );
});
