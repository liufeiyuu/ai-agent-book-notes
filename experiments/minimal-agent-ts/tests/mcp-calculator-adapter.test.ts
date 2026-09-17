import assert from "node:assert/strict";
import test from "node:test";
import { readCalculatorValue } from "../src/mcp/calculator-adapter";

test("structured numeric value is read directly, including zero", () => {
  assert.equal(readCalculatorValue({ content: [], structuredContent: { value: 0 } }), 0);
});

test("an MCP tool failure cannot become a successful numeric result", () => {
  assert.throws(() => readCalculatorValue({
    isError: true,
    content: [{ type: "text", text: "Cannot divide by zero." }],
    structuredContent: { value: 2 },
  }), /Cannot divide by zero/);
});

test("missing or malformed structured results are rejected instead of guessed from text", () => {
  for (const structuredContent of [{}, { value: "2" }, { value: Infinity }]) {
    assert.throws(() => readCalculatorValue({
      content: [{ type: "text", text: "2" }], structuredContent,
    }), /finite structuredContent.value/);
  }
  assert.throws(() => readCalculatorValue({ content: [{ type: "text", text: "2" }] }),
    /finite structuredContent.value/);
});
