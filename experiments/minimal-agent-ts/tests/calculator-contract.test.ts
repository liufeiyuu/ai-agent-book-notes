import assert from "node:assert/strict";
import test from "node:test";
import { executeToolCall } from "../src/tool-executor";
import { ToolRegistry } from "../src/tool-registry";
import { calculator, type CalculatorArguments } from "../src/tools/calculator";

test("extra JSON fields are rejected before calculator execution", async () => {
  let executions = 0;
  const registry = new ToolRegistry([{
    ...calculator,
    async execute(args: CalculatorArguments, signal?: AbortSignal) {
      executions += 1;
      return calculator.execute(args, signal);
    },
  }]);
  const result = await executeToolCall(registry, {
    id: "extra-field-case", name: "calculator",
    arguments: { operation: "divide", left: 6, right: 3, precision: 2 },
  });
  assert.equal(result.ok, false, JSON.stringify({ result, executions }));
  assert.equal(result.error.code, "invalid_arguments");
  assert.equal(result.toolCallId, "extra-field-case");
  assert.equal(executions, 0);
});
