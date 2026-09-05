import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runExperiment } from "../src/experiment.js";

const experiment = runExperiment();
const strategies = new Map(
  experiment.strategies.map((strategy) => [strategy.strategy, strategy]),
);

function getStrategy(name: "sparse" | "semantic_proxy" | "hybrid_rerank") {
  const strategy = strategies.get(name);
  assert.ok(strategy, `Missing strategy: ${name}`);
  return strategy;
}

function getQuery(
  strategyName: "sparse" | "semantic_proxy" | "hybrid_rerank",
  queryId: string,
) {
  const query = getStrategy(strategyName).queries.find(
    (candidate) => candidate.queryId === queryId,
  );
  assert.ok(query, `Missing query ${queryId} for ${strategyName}`);
  return query;
}

describe("minimal RAG retrieval experiment", () => {
  it("uses sparse retrieval for an exact error code", () => {
    const query = getQuery("sparse", "exact_identifier");
    assert.equal(query.goldRank, 1);
    assert.equal(query.recallAtK, true);
  });

  it("shows the lexical blind spot on a semantic paraphrase", () => {
    const sparseQuery = getQuery("sparse", "semantic_paraphrase");
    const semanticQuery = getQuery("semantic_proxy", "semantic_paraphrase");
    assert.equal(sparseQuery.recallAtK, false);
    assert.equal(semanticQuery.goldRank, 1);
  });

  it("shows why freshness is separate from recall", () => {
    const sparseQuery = getQuery("sparse", "fresh_policy");
    assert.equal(sparseQuery.recallAtK, true);
    assert.equal(sparseQuery.freshnessPassed, false);
  });

  it("uses hybrid signals to pass every retrieval condition", () => {
    const strategy = getStrategy("hybrid_rerank");
    assert.equal(strategy.recallAtK, 1);
    assert.equal(strategy.freshnessPassed, true);
    assert.equal(strategy.passesAllConditions, true);
    assert.ok(
      strategy.queries.every((query) => query.goldRank === 1),
      "Every gold document should be ranked first in the controlled corpus",
    );
  });

  it("records individual ranking signals in the trace", () => {
    const query = getQuery("hybrid_rerank", "fresh_policy");
    const currentPolicy = query.ranking.find(
      (document) => document.documentId === "refund-policy-2026",
    );
    const stalePolicy = query.ranking.find(
      (document) => document.documentId === "refund-policy-2024",
    );
    assert.ok(currentPolicy);
    assert.ok(stalePolicy);
    assert.ok(currentPolicy.signals.freshnessBoost > 0);
    assert.ok(stalePolicy.signals.freshnessBoost < 0);
    assert.equal(currentPolicy.rank, 1);
    assert.equal(stalePolicy.rank, 2);
  });
});
