import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SYSTEM_PROMPT = `SAFETY: Do not access the external network without user permission.
RULE: Preserve exact identifiers without rewriting them.`;

export const HARD_CONSTRAINT =
  "Do not access the external network for this task.";
export const ORDER_ID = "ORD-2026-0830";
export const FAILED_ACTION = "web_search";
export const FAILURE_REASON = "missing API key";
export const CURRENT_TODO =
  "Check whether the order satisfies the refund conditions.";
export const EVIDENCE = "A refund is allowed within 7 days of delivery.";
export const EVIDENCE_SOURCE = "doc://refund-policy-v3";

type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface StrategyResult {
  strategy: string;
  renderedContext: string;
  characterCount: number;
  roughTokenEstimate: number;
  compressionRatio: number;
  checks: CheckResult[];
  retentionPassed: boolean;
  sizeReductionPassed: boolean;
  passesAllConditions: boolean;
}

type CompressionStrategy = (messages: Message[]) => string;

function renderMessage(message: Message): string {
  return `[${message.role.toUpperCase()}]\n${message.content}`;
}

function renderMessages(messages: Message[]): string {
  return messages.map(renderMessage).join("\n\n");
}

// 第一站：构造同一份原始上下文，供三种策略共同使用。
export function buildScenario(): Message[] {
  const repeatedNoise = Array.from(
    { length: 420 },
    (_, index) => `navigation footer repeated content block ${String(index).padStart(3, "0")}`,
  );

  const noisyToolResult = [
    `SOURCE: ${EVIDENCE_SOURCE}`,
    EVIDENCE,
    ...repeatedNoise,
  ].join("\n");

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `HARD_CONSTRAINT: ${HARD_CONSTRAINT}\nORDER_ID: ${ORDER_ID}`,
    },
    {
      role: "assistant",
      content:
        "Plan: read the local refund policy, check eligibility, then ask for confirmation.",
    },
    { role: "tool", content: noisyToolResult },
    {
      role: "assistant",
      content:
        'TOOL_CALL id=call_web_1 name=web_search arguments={"query":"refund policy"}',
    },
    {
      role: "tool",
      content: `tool_call_id=call_web_1 ERROR: ${FAILED_ACTION} failed because of a ${FAILURE_REASON}.`,
    },
    {
      role: "assistant",
      content: `FAILED_ATTEMPT: ${FAILED_ACTION} failed because of a ${FAILURE_REASON}; do not retry it.`,
    },
  ];

  for (let index = 1; index <= 6; index += 1) {
    messages.push(
      { role: "user", content: `Unrelated small-talk message ${index}.` },
      {
        role: "assistant",
        content: `Unrelated small-talk response ${index}.`,
      },
    );
  }

  messages.push(
    { role: "user", content: "Continue processing the refund request." },
    { role: "user", content: `CURRENT_TODO: ${CURRENT_TODO}` },
  );

  return messages;
}

// 第二站 A：基线。什么都不删除，也什么都不提炼。
export function noCompression(messages: Message[]): string {
  return renderMessages(messages);
}

// 第二站 B：按位置保留最近四条轨迹，不判断内容是否重要。
export function slidingWindow(
  messages: Message[],
  windowSize = 4,
): string {
  const systemMessages = messages.filter(
    (message) => message.role === "system",
  );
  const trajectory = messages.filter((message) => message.role !== "system");
  return renderMessages([
    ...systemMessages,
    ...trajectory.slice(-windowSize),
  ]);
}

// 第二站 C：按固定 Schema 保留会影响后续决策的信息。
export function taskAwareStructuredCompression(
  _messages: Message[],
): string {
  const state = {
    hardConstraints: [
      {
        text: HARD_CONSTRAINT,
        source: "user",
        status: "active",
      },
    ],
    exactIdentifiers: { orderId: ORDER_ID },
    completedSteps: ["Read the local refund policy."],
    currentTodo: [CURRENT_TODO],
    failedAttempts: [
      {
        action: FAILED_ACTION,
        reason: FAILURE_REASON,
        retry: false,
      },
    ],
    evidence: [{ fact: EVIDENCE, source: EVIDENCE_SOURCE }],
    archivedContent: [
      {
        kind: "large_tool_result",
        source: EVIDENCE_SOURCE,
        runtimeStatus: "removed_after_extraction",
      },
    ],
  };

  const stateMessage: Message = {
    role: "user",
    content: `<agent_status>\n${JSON.stringify(state, null, 2)}\n</agent_status>`,
  };
  const currentRequest: Message = {
    role: "user",
    content: "Continue processing the refund request.",
  };

  return renderMessages([
    { role: "system", content: SYSTEM_PROMPT },
    stateMessage,
    currentRequest,
  ]);
}

function roughTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

// 第三站：实验的评分标准。每个策略都接受同一组检查。
export function evaluateRetention(context: string): CheckResult[] {
  return [
    {
      name: "hard_constraint",
      passed: context.includes(HARD_CONSTRAINT),
      detail: "The active no-network constraint must remain visible.",
    },
    {
      name: "exact_identifier",
      passed: context.includes(ORDER_ID),
      detail: "The order identifier must remain byte-for-byte identical.",
    },
    {
      name: "failed_path",
      passed:
        context.includes(FAILED_ACTION) &&
        context.includes(FAILURE_REASON) &&
        (context.includes("do not retry") || context.includes('"retry": false')),
      detail: "The failed action, reason, and no-retry decision must remain visible.",
    },
    {
      name: "current_todo",
      passed: context.includes(CURRENT_TODO),
      detail: "The current task state must remain visible.",
    },
    {
      name: "evidence",
      passed: context.includes(EVIDENCE),
      detail: "The task-relevant fact must remain visible.",
    },
    {
      name: "source",
      passed: context.includes(EVIDENCE_SOURCE),
      detail: "The retained fact must remain traceable to its source.",
    },
    {
      name: "system_prompt",
      passed: context.startsWith(`[SYSTEM]\n${SYSTEM_PROMPT}`),
      detail: "The stable system prompt must remain unchanged at the front.",
    },
  ];
}

function runStrategy(
  name: string,
  strategy: CompressionStrategy,
  messages: Message[],
  baselineCharacterCount: number,
): StrategyResult {
  const renderedContext = strategy(messages);
  const characterCount = renderedContext.length;
  const compressionRatio = characterCount / baselineCharacterCount;
  const checks = evaluateRetention(renderedContext);
  const retentionPassed = checks.every((check) => check.passed);
  const sizeReductionPassed = compressionRatio <= 0.5;

  return {
    strategy: name,
    renderedContext,
    characterCount,
    roughTokenEstimate: roughTokenEstimate(renderedContext),
    compressionRatio,
    checks,
    retentionPassed,
    sizeReductionPassed,
    passesAllConditions: retentionPassed && sizeReductionPassed,
  };
}

export function runExperiment(): StrategyResult[] {
  const messages = buildScenario();
  const baselineCharacterCount = noCompression(messages).length;
  const strategies: Array<[string, CompressionStrategy]> = [
    ["no_compression", noCompression],
    ["sliding_window", slidingWindow],
    ["task_aware_structured", taskAwareStructuredCompression],
  ];

  return strategies.map(([name, strategy]) =>
    runStrategy(name, strategy, messages, baselineCharacterCount),
  );
}

function printResults(results: StrategyResult[]): void {
  console.table(
    results.map((result) => ({
      strategy: result.strategy,
      chars: result.characterCount,
      roughTokens: result.roughTokenEstimate,
      ratio: `${(result.compressionRatio * 100).toFixed(1)}%`,
      retention: result.retentionPassed,
      sizeReduced: result.sizeReductionPassed,
      allPassed: result.passesAllConditions,
      failedChecks: result.checks
        .filter((check) => !check.passed)
        .map((check) => check.name)
        .join(", "),
    })),
  );
}

function saveResults(results: StrategyResult[]): string {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(
    currentDirectory,
    "../../runs/latest-typescript.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
  return outputPath;
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (currentFile === entryFile) {
  const results = runExperiment();
  printResults(results);
  console.log(`Trace saved to: ${saveResults(results)}`);
}
