import assert from "node:assert/strict";
import test from "node:test";

import { runAgent, type RunAgentOptions } from "../src/agent";
import { MockModel } from "../src/mock-model";
import { ToolRegistry } from "../src/tool-registry";
import { calculator } from "../src/tools/calculator";
import type { ModelResponse, ToolCall } from "../src/types";

const registry = new ToolRegistry([calculator]);

test("runs a tool call, writes its result into context, and returns final text", async () => {
  const model = new MockModel([
    toolResponse(call("call-add", "calculator", {
      operation: "add",
      left: 20,
      right: 22,
    })),
    finalResponse("The answer is 42."),
  ]);

  const result = await run(model, 3);

  assert.equal(result.completed, true);
  assert.equal(result.stopReason, "final_response");
  assert.equal(result.turns, 2);
  assert.equal(result.finalAnswer, "The answer is 42.");
  assert.equal(result.taskSuccess, undefined);
  assert.deepEqual(
    model.requests[1]?.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool"],
  );

  const toolMessage = model.requests[1]?.messages[3];
  assert.equal(toolMessage?.role, "tool");
  if (toolMessage?.role === "tool") {
    assert.equal(toolMessage.toolCallId, "call-add");
    assert.deepEqual(JSON.parse(toolMessage.content), {
      ok: true,
      toolCallId: "call-add",
      toolName: "calculator",
      output: 42,
    });
  }

  assert.deepEqual(
    result.trace.map((event) => event.type),
    [
      "model_request",
      "model_response",
      "tool_start",
      "tool_end",
      "model_request",
      "model_response",
      "run_stop",
    ],
  );
});

test("writes an unknown-tool failure back and lets the model recover", async () => {
  const model = new MockModel([
    toolResponse(call("call-missing", "weather", { city: "Shanghai" })),
    finalResponse("The weather tool is unavailable."),
  ]);

  const result = await run(model, 3);

  assert.equal(result.completed, true);
  assert.equal(result.turns, 2);
  const failure = readLastToolResult(model, 1);
  assert.equal(failure.ok, false);
  if (!failure.ok) {
    assert.equal(failure.error.code, "tool_not_found");
  }
});

test("lets the model correct invalid arguments on the next turn", async () => {
  const model = new MockModel([
    toolResponse(call("call-bad", "calculator", {
      operation: "power",
      left: 2,
      right: 8,
    })),
    toolResponse(call("call-fixed", "calculator", {
      operation: "multiply",
      left: 2,
      right: 8,
    })),
    finalResponse("2 × 8 = 16."),
  ]);

  const result = await run(model, 4);

  assert.equal(result.completed, true);
  assert.equal(result.turns, 3);

  const firstResult = readLastToolResult(model, 1);
  assert.equal(firstResult.ok, false);
  if (!firstResult.ok) {
    assert.equal(firstResult.error.code, "invalid_arguments");
    assert.equal(firstResult.error.retryable, true);
  }

  const secondResult = readLastToolResult(model, 2);
  assert.deepEqual(secondResult, {
    ok: true,
    toolCallId: "call-fixed",
    toolName: "calculator",
    output: 16,
  });
});

test("stops after maxTurns when the model keeps requesting tools", async () => {
  const model = new MockModel((_input, requestIndex) =>
    toolResponse(call(`call-${requestIndex + 1}`, "calculator", {
      operation: "add",
      left: requestIndex,
      right: 1,
    })),
  );

  const result = await run(model, 2);

  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "max_turns");
  assert.equal(result.turns, 2);
  assert.equal(model.requests.length, 2);
  assert.equal(
    result.trace.filter((event) => event.type === "tool_end").length,
    2,
  );
  assert.equal(result.trace.at(-1)?.type, "run_stop");
});

test("reports model errors without pretending the run completed", async () => {
  const model = new MockModel(async () => {
    throw new Error("provider unavailable");
  });

  const result = await run(model, 2);

  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "model_error");
  assert.equal(result.error, "provider unavailable");
});

test("honors an already-aborted user signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const model = new MockModel([finalResponse("should not be called")]);

  const result = await runAgent({
    model,
    registry,
    systemPrompt: "You are a calculator agent.",
    userInput: "Calculate something.",
    maxTurns: 2,
    signal: controller.signal,
  });

  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "cancelled");
  assert.equal(result.turns, 0);
  assert.equal(model.requests.length, 0);
});

test("enforces timeout even when the model ignores AbortSignal", async () => {
  const model = new MockModel(
    () => new Promise<ModelResponse>(() => undefined),
  );

  const result = await runAgent({
    model,
    registry,
    systemPrompt: "You are a calculator agent.",
    userInput: "Calculate something.",
    maxTurns: 2,
    timeoutMs: 10,
  });

  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "timeout");
  assert.equal(result.turns, 1);
});

test("accepts an immediate final answer when no task-specific hooks are supplied", async () => {
  const model = new MockModel([finalResponse("No tools needed.")]);

  const result = await run(model, 2);

  assert.equal(result.completed, true);
  assert.equal(result.finalAnswer, "No tools needed.");
  assert.equal(result.turns, 1);
  const request = result.trace.find(event => event.type === "model_request");
  assert.equal(request?.toolChoice, undefined);
  assert.equal(result.trace.some(event => event.type === "final_rejected"), false);
});

test("rejects premature final text, retains the draft, and continues with corrective context", async () => {
  const model = new MockModel([
    finalResponse("I have not calculated yet."),
    toolResponse(call("after-rejection", "calculator", { operation: "add", left: 20, right: 22 })),
    finalResponse("The answer is 42."),
  ]);
  const reason = "Call calculator before giving a final answer.";
  let validations = 0;
  const result = await run(model, 3, {
    validateFinal: () => ++validations === 1 ? reason : undefined,
  });

  assert.equal(result.completed, true);
  assert.equal(result.finalAnswer, "The answer is 42.");
  assert.equal(result.turns, 3);
  assert.equal(validations, 2); // Tool responses do not invoke the final-answer guard.
  assert.deepEqual(model.requests[1]?.messages.slice(-2), [
    { role: "assistant", content: "I have not calculated yet.", toolCalls: [] },
    { role: "system", content: reason },
  ]);
  assert.deepEqual(result.trace.filter(event => event.type === "final_rejected").map(event => ({
    turn: event.turn, reason: event.reason,
  })), [{ turn: 1, reason }]);
  assert.equal(result.trace.filter(event => event.type === "tool_end").length, 1);
});

test("keeps repeated final-answer rejections within the original maxTurns budget", async () => {
  const model = new MockModel(() => finalResponse("Premature final."));

  const result = await run(model, 2, { validateFinal: () => "Complete the required tool step." });

  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "max_turns");
  assert.equal(result.finalAnswer, undefined);
  assert.equal(result.turns, 2);
  assert.equal(model.requests.length, 2);
  assert.equal(result.trace.filter(event => event.type === "final_rejected").length, 2);
  assert.equal(result.messages.filter(message => message.role === "assistant").length, 2);
});

test("prepares every request and traces the same transformed context, tools, and choice", async () => {
  const observedChoices: Array<string | undefined> = [];
  const model = new MockModel((input, index) => {
    observedChoices.push(input.toolChoice);
    return finalResponse(index === 0 ? "First draft." : "Second draft.");
  });
  let preparations = 0;
  let validations = 0;
  const result = await run(model, 2, {
    prepareRequest: input => ({
      ...input,
      messages: [...input.messages, { role: "system", content: `Prepared turn ${++preparations}.` }],
      tools: input.tools.map(tool => ({ ...tool, description: "Use this transformed definition." })),
      toolChoice: "required",
    }),
    validateFinal: () => ++validations === 1 ? "Continue." : undefined,
  });

  assert.equal(result.completed, true);
  assert.equal(preparations, 2);
  const requests = result.trace.filter(event => event.type === "model_request");
  for (const [index, event] of requests.entries()) {
    assert.deepEqual(event.messages, model.requests[index]?.messages);
    assert.deepEqual(event.tools, model.requests[index]?.tools);
    assert.equal(event.toolChoice, "required");
    assert.equal(observedChoices[index], "required");
  }
  assert.equal(model.requests[1]?.messages.some(message =>
    message.content === "Prepared turn 1."), false); // Request-only additions do not leak into history.
});

test("reports request and final-validation hook exceptions as model errors", async () => {
  const notCalled = new MockModel([finalResponse("Not reached.")]);
  const prepareFailure = await run(notCalled, 2, {
    prepareRequest: () => { throw new Error("bad request policy"); },
  });
  assert.equal(prepareFailure.completed, false);
  assert.equal(prepareFailure.stopReason, "model_error");
  assert.equal(prepareFailure.error, "prepareRequest failed: bad request policy");
  assert.equal(notCalled.requests.length, 0);

  const model = new MockModel([finalResponse("Retain this draft.")]);
  const validationFailure = await run(model, 2, {
    validateFinal: () => { throw new Error("bad final policy"); },
  });
  assert.equal(validationFailure.completed, false);
  assert.equal(validationFailure.stopReason, "model_error");
  assert.equal(validationFailure.error, "validateFinal failed: bad final policy");
  assert.equal(validationFailure.messages.at(-1)?.content, "Retain this draft.");
});

test("does not turn truncated or empty responses into final-answer retries", async () => {
  for (const response of [
    { ...finalResponse("Truncated"), finishReason: "length" as const },
    { ...finalResponse(""), message: { role: "assistant" as const, content: null, toolCalls: [] } },
  ]) {
    let validations = 0;
    const result = await run(new MockModel([response]), 2, {
      validateFinal: () => { validations++; return "Retry."; },
    });
    assert.equal(result.completed, false);
    assert.equal(result.stopReason, "model_error");
    assert.equal(validations, 0);
  }
});

function run(model: MockModel, maxTurns: number,
  hooks: Pick<RunAgentOptions, "prepareRequest" | "validateFinal"> = {}) {
  return runAgent({
    model,
    registry,
    systemPrompt: "You are a calculator agent.",
    userInput: "Complete the task.",
    maxTurns,
    ...hooks,
  });
}

function call(
  id: string,
  name: string,
  arguments_: Record<string, unknown>,
): ToolCall {
  return { id, name, arguments: arguments_ };
}

function toolResponse(...toolCalls: ToolCall[]): ModelResponse {
  return {
    finishReason: "tool_calls",
    message: { role: "assistant", content: null, toolCalls },
  };
}

function finalResponse(content: string): ModelResponse {
  return {
    finishReason: "stop",
    message: { role: "assistant", content, toolCalls: [] },
  };
}

function readLastToolResult(model: MockModel, requestIndex: number): ToolResultJson {
  const message = model.requests[requestIndex]?.messages.at(-1);
  assert.equal(message?.role, "tool");
  if (message?.role !== "tool") {
    throw new Error("Expected the last message to be a tool message.");
  }

  return JSON.parse(message.content) as ToolResultJson;
}

type ToolResultJson =
  | {
      ok: true;
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | {
      ok: false;
      toolCallId: string;
      toolName: string;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };
