import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type { Model } from "../../minimal-agent-ts/src/types";
import { applyCandidate, readMemory, validateCandidate, MEMORY_KEY } from "../src/store";
import { buildAnswerMessages, extractCandidate, generateText } from "../src/memory";
import { attemptsUsed, createMemoryModel, redact, reserveAttempt, MAX_ATTEMPTS } from "../src/runtime";

const briefText = "以后讲代码时请简短一点。";
const detailedText = "纠正一下，以后讲代码请详细解释。";
async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(resolve(tmpdir(), "user-memory-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function fixtureModel(content: string, finishReason: "stop" | "length" = "stop"): Model {
  return { generate: async () => ({ finishReason, message: { role: "assistant", content, toolCalls: [] } }) };
}

test("candidate schema rejects invented evidence, extra identity fields and invalid values", () => {
  assert.deepEqual(validateCandidate({ value: "brief", evidence: briefText }, briefText), { value: "brief", evidence: briefText });
  assert.throws(() => validateCandidate({ value: "brief", evidence: "不是用户原话" }, briefText));
  assert.throws(() => validateCandidate({ value: "brief", evidence: briefText, userId: "demo-b" }, briefText));
  assert.throws(() => validateCandidate({ value: "verbose", evidence: briefText }, briefText));
  assert.throws(() => validateCandidate({ value: "none", evidence: briefText }, briefText));
});

test("extraction invokes supplied model and sends only rules plus current input (offline fixture)", async () => {
  let called = 0;
  const model: Model = { generate: async input => {
    called++;
    assert.deepEqual(input.tools, []);
    assert.equal(input.messages.length, 2);
    assert.deepEqual(input.messages[1], { role: "user", content: briefText });
    return { finishReason: "stop", message: { role: "assistant", content: JSON.stringify({ value: "brief", evidence: briefText }), toolCalls: [] } };
  } };
  assert.equal((await extractCandidate(model, briefText)).candidate.value, "brief");
  assert.equal(called, 1);
});

test("strict extraction rejects fences, truncation and empty answers without recovery", async () => {
  await assert.rejects(extractCandidate(fixtureModel('```json\n{"value":"none","evidence":""}\n```'), briefText));
  await assert.rejects(extractCandidate(fixtureModel('{"value":"none","evidence":""}', "length"), briefText), /finish_reason=length/);
  await assert.rejects(generateText(fixtureModel(""), []));
});

test("ADD persists identity bound by program; UPDATE replaces same current record", async t => {
  const path = resolve(await scratch(t), "memory.json");
  assert.equal(await readMemory(path, "demo-a"), null);
  assert.equal((await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText)).action, "ADD");
  const changed = await applyCandidate(path, "demo-a", { value: "detailed", evidence: detailedText }, detailedText);
  assert.equal(changed.action, "UPDATE");
  assert.equal(changed.previous?.value, "brief");
  assert.equal(changed.current?.value, "detailed");
  const data = JSON.parse(await readFile(path, "utf8"));
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].key, MEMORY_KEY);
  assert.equal(data.records[0].userId, "demo-a");
});

test("NOOP does not create, erase or rewrite a stored preference", async t => {
  const path = resolve(await scratch(t), "memory.json");
  assert.equal((await applyCandidate(path, "demo-a", { value: "none", evidence: "" }, "解释一下工具调用")).action, "NOOP");
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText);
  const before = await readFile(path, "utf8");
  assert.equal((await applyCandidate(path, "demo-a", { value: "none", evidence: "" }, "解释一下工具调用")).action, "NOOP");
  assert.equal((await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText)).action, "NOOP");
  assert.equal(await readFile(path, "utf8"), before);
});

test("user and topic isolation; other user's current record survives an update", async t => {
  const path = resolve(await scratch(t), "memory.json");
  await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText);
  assert.equal(await readMemory(path, "demo-b"), null);
  assert.equal(await readMemory(path, "demo-a", "other"), null);
  await applyCandidate(path, "demo-b", { value: "brief", evidence: briefText }, briefText);
  await applyCandidate(path, "demo-a", { value: "detailed", evidence: detailedText }, detailedText);
  assert.equal((await readMemory(path, "demo-b"))?.value, "brief");
  await assert.rejects(readMemory(path, "../demo-a"));
});

test("a new process reads persistence without the previous conversation", async t => {
  const path = resolve(await scratch(t), "memory.json");
  await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText);
  const loader = resolve(dirname(fileURLToPath(import.meta.url)), "../../minimal-agent-ts/node_modules/tsx/dist/loader.mjs");
  const storeUrl = new URL("../src/store.ts", import.meta.url).href;
  const output = execFileSync(process.execPath, ["--import", loader, "--input-type=module", "-e",
    `import {readMemory} from ${JSON.stringify(storeUrl)}; console.log(JSON.stringify({pid:process.pid,memory:await readMemory(${JSON.stringify(path)},"demo-a")}));`], { encoding: "utf8" });
  const child = JSON.parse(output);
  assert.notEqual(child.pid, process.pid);
  assert.equal(child.memory.value, "brief");
});

test("new answer context contains only current validated preference, never old source history", async t => {
  const path = resolve(await scratch(t), "memory.json");
  await applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText);
  await applyCandidate(path, "demo-a", { value: "detailed", evidence: detailedText }, detailedText);
  const messages = buildAnswerMessages("解释一下工具调用", await readMemory(path, "demo-a"));
  assert.deepEqual(messages.map(m => m.role), ["system", "user"]);
  assert.match(messages[0]!.content!, /"value":"detailed"/);
  assert.match(messages[0]!.content!, /250–350/);
  assert.doesNotMatch(JSON.stringify(messages), /"value":"brief"/);
  assert.ok(!JSON.stringify(messages).includes(briefText));
  assert.ok(!JSON.stringify(messages).includes(detailedText));
  assert.doesNotMatch(JSON.stringify(buildAnswerMessages("今天怎么样", null)), /code_explanation_detail/);
});

test("corrupt or duplicate store fails closed instead of overwriting", async t => {
  const path = resolve(await scratch(t), "memory.json");
  await writeFile(path, "not-json");
  await assert.rejects(applyCandidate(path, "demo-a", { value: "brief", evidence: briefText }, briefText));
  assert.equal(await readFile(path, "utf8"), "not-json");
  const record = { userId: "demo-a", key: MEMORY_KEY, value: "brief", sourceText: briefText, evidence: briefText, updatedAt: new Date().toISOString() };
  await writeFile(path, JSON.stringify({ schemaVersion: 1, records: [record, record] }));
  await assert.rejects(readMemory(path, "demo-a"), /Duplicate/);
});

test("persistent attempt slots preserve four used records and enforce the approved limit concurrently", async t => {
  const directory = await scratch(t);
  for (let number = 1; number <= 4; number++) {
    assert.equal(await reserveAttempt(directory, { test: true }), number);
  }
  const original = await Promise.all([1, 2, 3, 4].map(number => readFile(resolve(directory, `${number}.json`), "utf8")));
  const slots = await Promise.all(Array.from({ length: MAX_ATTEMPTS - 4 }, () => reserveAttempt(directory, { test: true })));
  assert.equal(new Set(slots).size, MAX_ATTEMPTS - 4);
  assert.equal(Math.min(...slots), 5);
  assert.equal(Math.max(...slots), MAX_ATTEMPTS);
  assert.equal(await attemptsUsed(directory), MAX_ATTEMPTS);
  assert.deepEqual(await Promise.all([1, 2, 3, 4].map(number => readFile(resolve(directory, `${number}.json`), "utf8"))), original);
  await assert.rejects(reserveAttempt(directory, {}), /exhausted/);
});

test("transport preserves real-shaped request schema and excludes credentials from captured bodies (offline)", async t => {
  const directory = await scratch(t);
  const runtime = createMemoryModel({
    apiKey: "test-key", model: "deepseek/deepseek-v4-flash-0731", kind: "remember", userId: "demo-a", budgetDirectory: directory,
    fetch: async (_url, init) => {
      assert.match(String(init?.body), /memory_candidate/);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ value: "brief", evidence: briefText }) } }] });
    },
  });
  assert.equal((await extractCandidate(runtime.model, briefText)).candidate.value, "brief");
  assert.deepEqual(runtime.requests[0]!.reasoning, { enabled: false });
  assert.equal(runtime.requests[0]!.tools, undefined);
  assert.ok(!JSON.stringify(runtime.requests).includes("test-key"));
  assert.equal(await attemptsUsed(directory), 1);
});

test("failed network consumes one slot, has no silent retry and no fabricated answer", async t => {
  const directory = await scratch(t);
  let attempts = 0;
  const runtime = createMemoryModel({
    apiKey: "test-key", model: "test-model", kind: "ask", userId: "demo-a", budgetDirectory: directory,
    fetch: async () => { attempts++; throw new Error("network unavailable"); },
  });
  await assert.rejects(generateText(runtime.model, buildAnswerMessages("问题", null)), /network unavailable/);
  assert.equal(attempts, 1);
  assert.equal(await attemptsUsed(directory), 1);
  assert.equal(runtime.requests[0]!.response_format, undefined);
});

test("raw non-JSON HTTP error remains observable, and redaction removes echoed secrets", async t => {
  const runtime = createMemoryModel({
    apiKey: "test-key", model: "test-model", kind: "ask", userId: "demo-a", budgetDirectory: await scratch(t),
    fetch: async () => new Response("invalid upstream response", { status: 502 }),
  });
  await assert.rejects(generateText(runtime.model, buildAnswerMessages("问题", null)), /non-JSON/);
  assert.equal(runtime.responses[0]!.status, 502);
  assert.equal(runtime.responses[0]!.body, "invalid upstream response");
  assert.equal(redact("test-key and sk-or-example", "test-key"), "[REDACTED] and [REDACTED]");
});
