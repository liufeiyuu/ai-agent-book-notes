import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadSettings, requireKey, requireChatModel } from "../../refund-agent-real/src/config";
import { saveJson } from "../../refund-agent-real/src/index-store";
import { applyCandidate, readMemory, validateUserId } from "./store";
import { buildAnswerMessages, extractCandidate, generateText } from "./memory";
import { attemptsUsed, createMemoryModel, redact, MAX_ATTEMPTS } from "./runtime";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MEMORY_PATH = resolve(ROOT, "data/memory.json");
const BUDGET_DIRECTORY = resolve(ROOT, "runs/call-budget");

function parseArgs(): { command: "status" | "remember" | "ask"; userId: string; topic: "code" | "other"; text: string } {
  const [command = "status", ...args] = process.argv.slice(2);
  if (!["status", "remember", "ask"].includes(command)) throw new Error("Use status, remember or ask.");
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !["--user", "--text", "--topic"].includes(key) || !value || value.startsWith("--") || flags[key] !== undefined) {
      throw new Error("Use unique --user, --text and --topic value pairs.");
    }
    flags[key] = value;
  }
  const userId = flags["--user"] ?? "demo-a";
  const topic = flags["--topic"] ?? "code";
  validateUserId(userId);
  if (topic !== "code" && topic !== "other") throw new Error("Topic must be code or other.");
  if (command === "remember" && topic !== "code") throw new Error("This experiment only remembers code explanation preferences.");
  if (command === "status" && flags["--text"] !== undefined) throw new Error("status does not accept --text.");
  const text = flags["--text"] ?? "";
  if (command !== "status" && (!text.trim() || text.length > 2000)) throw new Error("Provide --text with 1–2000 characters.");
  return { command: command as "status" | "remember" | "ask", userId, topic, text };
}

async function main() {
  const { command, userId, topic, text } = parseArgs();
  // 从文件找出当前用户的偏好
  const before = await readMemory(MEMORY_PATH, userId, topic);
  if (command === "status") {
    console.log(JSON.stringify({ userId, topic, memoryPath: MEMORY_PATH, currentMemory: before, apiAttempts: { used: await attemptsUsed(BUDGET_DIRECTORY), limit: MAX_ATTEMPTS } }, null, 2));
    return;
  }
  const settings = await loadSettings();
  const apiKey = requireKey(settings), modelName = requireChatModel(settings);
  const runtime = createMemoryModel({ apiKey, model: modelName, kind: command, userId, budgetDirectory: BUDGET_DIRECTORY });
  const runPath = resolve(ROOT, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${command}-${randomUUID().slice(0, 8)}.json`);
  const trace: Record<string, unknown> = {
    command, userId, topic, input: text, pid: process.pid, startedAt: new Date().toISOString(),
    model: modelName, oldConversationHistoryIncluded: false, memoryBefore: before,
  };
  try {
    // 模型返回了“简短”，不等于已经记住；程序把它写进文件，才有了跨进程保留的基础。
    if (command === "remember") {
      // 调用模型，提取并校验候选。
      const extracted = await extractCandidate(runtime.model, text);
      trace.extraction = extracted;
      // 程序根据候选决定新增、更新或不操作
      trace.mutation = await applyCandidate(MEMORY_PATH, userId, extracted.candidate, text);
      console.log(redact(JSON.stringify(trace.mutation, null, 2), apiKey));
    } else {
      // 把偏好和当前问题组织成模型输入。
      const messages = buildAnswerMessages(text, before);
      trace.loadedMemory = before;
      // 把这些消息发给模型，取得回答。
      trace.answer = await generateText(runtime.model, messages);
      trace.requiresHumanReview = true;
      console.log(redact(String(trace.answer), apiKey));
    }
    trace.executionCompleted = true;
  } catch (error) {
    trace.executionCompleted = false;
    trace.error = redact(error instanceof Error ? error.message : String(error), apiKey);
    process.exitCode = 1;
    console.error(trace.error);
  } finally {
    Object.assign(trace, {
      requests: runtime.requests, responses: runtime.responses, attempts: runtime.attempts,
      cumulativeApiAttempts: await attemptsUsed(BUDGET_DIRECTORY), finishedAt: new Date().toISOString(),
    });
    await saveJson(runPath, JSON.parse(redact(JSON.stringify(trace), apiKey)));
    console.log(`Trace: ${runPath}`);
  }
}

main().catch(error => { console.error(redact(error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
