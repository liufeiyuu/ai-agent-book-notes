import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenRouterApiError,
  OpenRouterModel,
  parseOpenRouterResponse,
} from "../src/openrouter-model";
import type { ModelInput } from "../src/types";

test("converts internal messages and tool definitions to OpenRouter format", async () => {
  let capturedBody: unknown;
  let capturedHeaders: Headers | undefined;
  const model = new OpenRouterModel({
    apiKey: "test-key",
    model: "test/model",
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as unknown;
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse(toolCallApiResponse());
    },
  });

  const response = await model.generate(modelInput());

  assert.equal(capturedHeaders?.get("Authorization"), "Bearer test-key");
  assert.deepEqual(capturedBody, {
    model: "test/model",
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Add 20 and 22." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "previous-call",
            type: "function",
            function: {
              name: "calculator",
              arguments: "{\"operation\":\"add\",\"left\":1,\"right\":1}",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "previous-call",
        content: "{\"ok\":true,\"output\":2}",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "calculator",
          description: "Calculate.",
          parameters: { type: "object" },
        },
      },
    ],
    tool_choice: "auto",
  });
  assert.deepEqual(response, {
    finishReason: "tool_calls",
    message: {
      role: "assistant",
      content: null,
      toolCalls: [
        {
          id: "call-add",
          name: "calculator",
          arguments: { operation: "add", left: 20, right: 22 },
        },
      ],
    },
  });
  assert.equal(model.exchanges.length, 1);
  assert.equal(model.exchanges[0]?.responseStatus, 200);
  assert.equal("headers" in (model.exchanges[0]?.request ?? {}), false);
});

test("keeps malformed argument JSON untrusted for Tool validation", () => {
  const response = parseOpenRouterResponse(toolCallApiResponse("{bad-json"));

  assert.equal(response.message.toolCalls[0]?.arguments, "{bad-json");
});

test("converts a final OpenRouter response to an internal final response", () => {
  const response = parseOpenRouterResponse({
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "The answer is 42." },
      },
    ],
  });

  assert.deepEqual(response, {
    finishReason: "stop",
    message: {
      role: "assistant",
      content: "The answer is 42.",
      toolCalls: [],
    },
  });
});

test("throws a typed error for a non-success OpenRouter response", async () => {
  const model = new OpenRouterModel({
    apiKey: "test-key",
    model: "test/model",
    fetch: async () =>
      jsonResponse({ error: { message: "insufficient credits" } }, 402),
  });

  await assert.rejects(
    model.generate(modelInput()),
    (error: unknown) => {
      assert.ok(error instanceof OpenRouterApiError);
      assert.equal(error.status, 402);
      assert.match(error.message, /insufficient credits/);
      return true;
    },
  );
});

function modelInput(): ModelInput {
  return {
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Add 20 and 22." },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "previous-call",
            name: "calculator",
            arguments: { operation: "add", left: 1, right: 1 },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "previous-call",
        content: "{\"ok\":true,\"output\":2}",
      },
    ],
    tools: [
      {
        name: "calculator",
        description: "Calculate.",
        inputSchema: { type: "object" },
      },
    ],
  };
}

function toolCallApiResponse(
  arguments_ = "{\"operation\":\"add\",\"left\":20,\"right\":22}",
) {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-add",
              type: "function",
              function: {
                name: "calculator",
                arguments: arguments_,
              },
            },
          ],
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
