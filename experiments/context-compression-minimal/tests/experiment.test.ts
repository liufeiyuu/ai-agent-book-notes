import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SYSTEM_PROMPT, runExperiment } from "../src/experiment.js";

const results = new Map(
  runExperiment().map((result) => [result.strategy, result]),
);

function getResult(strategy: string) {
  const result = results.get(strategy);
  assert.ok(result, `Missing result for ${strategy}`);
  return result;
}

describe("context compression strategies", () => {
  it("keeps information but does not reduce size without compression", () => {
    const result = getResult("no_compression");
    assert.equal(result.retentionPassed, true);
    assert.equal(result.sizeReductionPassed, false);
    assert.equal(result.passesAllConditions, false);
  });

  it("loses early task information with a sliding window", () => {
    const result = getResult("sliding_window");
    const failedChecks = new Set(
      result.checks
        .filter((check) => !check.passed)
        .map((check) => check.name),
    );

    assert.ok(failedChecks.has("hard_constraint"));
    assert.ok(failedChecks.has("exact_identifier"));
    assert.ok(failedChecks.has("failed_path"));
    assert.ok(failedChecks.has("evidence"));
    assert.equal(result.passesAllConditions, false);
  });

  it("passes retention and size checks with structured compression", () => {
    const result = getResult("task_aware_structured");
    assert.equal(result.retentionPassed, true);
    assert.equal(result.sizeReductionPassed, true);
    assert.equal(result.passesAllConditions, true);
    assert.ok(result.compressionRatio <= 0.5);
  });

  it("keeps the stable system prompt unchanged", () => {
    const result = getResult("task_aware_structured");
    assert.ok(result.renderedContext.startsWith(`[SYSTEM]\n${SYSTEM_PROMPT}`));
  });
});
