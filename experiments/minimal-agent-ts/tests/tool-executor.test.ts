import assert from "node:assert/strict";
import test from "node:test";

import {
  executeToolCall,
  toolResultToMessage,
} from "../src/tool-executor";
import { ToolRegistry } from "../src/tool-registry";
import { calculator } from "../src/tools/calculator";
import type { ToolCall } from "../src/types";

const registry = new ToolRegistry([calculator]);

test("executes a valid tool call", async () => {
  const result = await executeToolCall(
    registry,
    call("calculator", {
      operation: "multiply",
      left: 6,
      right: 7,
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    toolCallId: "call-1",
    toolName: "calculator",
    output: 42,
  });
});

test("returns tool_not_found instead of throwing", async () => {
  const result = await executeToolCall(
    registry,
    call("missing_tool", {}),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "tool_not_found");
    assert.equal(result.error.retryable, false);
  }
});

test("returns invalid_arguments when parsing fails", async () => {
  const result = await executeToolCall(
    registry,
    call("calculator", {
      operation: "power",
      left: 2,
      right: 8,
    }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_arguments");
    assert.equal(result.error.retryable, true);
  }
});

test("returns execution_error when a tool throws", async () => {
  const result = await executeToolCall(
    registry,
    call("calculator", {
      operation: "divide",
      left: 1,
      right: 0,
    }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "execution_error");
    assert.match(result.error.message, /divide by zero/);
  }
});

test("returns cancelled for an aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();

  const result = await executeToolCall(
    registry,
    call("calculator", { operation: "add", left: 1, right: 2 }),
    { signal: controller.signal },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "cancelled");
  }
});

test("serializes a tool result into a correlated tool message", async () => {
  const result = await executeToolCall(
    registry,
    call("calculator", { operation: "add", left: 20, right: 22 }),
  );
  const message = toolResultToMessage(result);

  assert.equal(message.role, "tool");
  assert.equal(message.toolCallId, "call-1");
  assert.deepEqual(JSON.parse(message.content), result);
});

function call(
  name: string,
  arguments_: Record<string, unknown>,
): ToolCall {
  return {
    id: "call-1",
    name,
    arguments: arguments_,
  };
}
