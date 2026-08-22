import assert from "node:assert/strict";
import test from "node:test";

import { calculator } from "../src/tools/calculator";

test("parses and executes supported operations", async () => {
  const cases = [
    [{ operation: "add", left: 7, right: 5 }, 12],
    [{ operation: "subtract", left: 7, right: 5 }, 2],
    [{ operation: "multiply", left: 7, right: 5 }, 35],
    [{ operation: "divide", left: 10, right: 4 }, 2.5],
  ] as const;

  for (const [input, expected] of cases) {
    const arguments_ = calculator.parseArguments(input);
    assert.equal(await calculator.execute(arguments_), expected);
  }
});

test("rejects malformed arguments before execution", () => {
  assert.throws(
    () => calculator.parseArguments({ operation: "power", left: 2, right: 3 }),
    /operation must be one of/,
  );
  assert.throws(
    () => calculator.parseArguments({ operation: "add", left: NaN, right: 3 }),
    /left and right must be finite numbers/,
  );
});

test("rejects division by zero during execution", async () => {
  const arguments_ = calculator.parseArguments({
    operation: "divide",
    left: 10,
    right: 0,
  });

  await assert.rejects(
    calculator.execute(arguments_),
    /Cannot divide by zero/,
  );
});

test("honors an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    calculator.execute(
      { operation: "add", left: 1, right: 2 },
      controller.signal,
    ),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
});
