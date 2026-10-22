import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { evaluatePolicySearches, type PolicySearchObservation } from "./evaluation";

type SavedCase = {
  source: string; sourceSha256: string; caseId: string; mode: string;
  searches: PolicySearchObservation[];
  historicalChecks: Array<{ name: string; passed: boolean }>;
  historicalAutomatedPassed: boolean; historicalApiCalls: number; historicalElapsedMs: number;
  expectedProcessPassed: boolean; expectedCombinedPassed: boolean;
};
const startedAt = new Date().toISOString();
const fixtureBytes = await readFile(new URL("../fixtures/evaluation/b2-traces.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString()) as { records: SavedCase[] };

// 只重放新增的过程检查，并与原记录的检查合并；不重跑生成，也不冒充全量现行规则重评。
const results = fixture.records.map(row => {
  const processCheck = evaluatePolicySearches(row.searches);
  assert.equal(row.historicalChecks.every(check => check.passed), row.historicalAutomatedPassed);
  const afterPassed = [...row.historicalChecks, processCheck].every(check => check.passed);
  assert.equal(processCheck.passed, row.expectedProcessPassed);
  assert.equal(afterPassed, row.expectedCombinedPassed);
  return { source: row.source, sourceSha256: row.sourceSha256, caseId: row.caseId, mode: row.mode,
    beforePassed: row.historicalAutomatedPassed, afterPassed, processCheck,
    failedChecks: [...row.historicalChecks, processCheck].filter(check => !check.passed).map(check => check.name),
    searchCount: row.searches.length,
    historicalApiCalls: row.historicalApiCalls, historicalElapsedMs: row.historicalElapsedMs };
});
const report = { mode: "offline_saved_trace_check_replay", startedAt, finishedAt: new Date().toISOString(),
  realModelCalls: 0, scriptedModelCalls: 0, embeddingCalls: 0,
  gradingVersion: "historical-checks-plus-empty-candidates-stop-v1",
  scope: "新增过程检查与各记录历史检查合并；不是重新运行 Agent，也不是全量现行验证器重评。",
  comparisonLimit: "历史运行的 Prompt、流程约束和格式恢复配置有差异，不能据此估计模型改进或节省比例。",
  fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"), results };
const directory = new URL("../artifacts/", import.meta.url);
await mkdir(directory, { recursive: true });
const destination = new URL(`b2-replay-${startedAt.replace(/[:.]/g, "-")}.json`, directory);
await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
for (const row of results) console.log(`${row.caseId}: ${row.beforePassed ? "PASS" : "FAIL"} -> ${row.afterPassed ? "PASS" : "FAIL"}; searches=${row.searchCount}; ${row.failedChecks.join(", ") || "all checks passed"}`);
console.log(`Verified ${results.length} saved cases; new model/API calls=0`);
console.log(`Report: ${fileURLToPath(destination)}`);
