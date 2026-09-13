import { readFile } from "node:fs/promises";
import { saveJson } from "../../refund-agent-real/src/index-store";

export const MEMORY_KEY = "code_explanation_detail";
export type Detail = "brief" | "detailed";
export type Candidate = { value: Detail | "none"; evidence: string };
export type Memory = {
  userId: string;
  key: typeof MEMORY_KEY;
  value: Detail;
  sourceText: string;
  evidence: string;
  updatedAt: string;
};
type MemoryFile = { schemaVersion: 1; records: Memory[] };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateUserId(userId: string): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(userId)) throw new Error("Invalid synthetic user ID.");
}

// 学习入口 2：模型的输出只是候选，程序检查字段、枚举及引文来源。
export function validateCandidate(value: unknown, sourceText: string): Candidate {
  if (!sourceText.trim() || sourceText.length > 2000) throw new Error("User text must contain 1–2000 characters.");
  if (!isRecord(value) || !exactKeys(value, ["value", "evidence"]) ||
      !["brief", "detailed", "none"].includes(String(value.value)) || typeof value.value !== "string" ||
      typeof value.evidence !== "string") throw new Error("Invalid memory candidate schema.");
  if (value.value === "none") {
    if (value.evidence !== "") throw new Error("Ignored input must have empty evidence.");
  } else if (!value.evidence.trim() || !sourceText.includes(value.evidence)) {
    throw new Error("Memory evidence must be an exact quote from this user's input.");
  }
  // Exact quotation checks provenance, not whether the model understood the preference correctly.
  return value as Candidate;
}

async function readAll(path: string): Promise<MemoryFile> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, records: [] }; throw error; }
  const file: unknown = JSON.parse(text);
  if (!isRecord(file) || !exactKeys(file, ["schemaVersion", "records"]) ||
      file.schemaVersion !== 1 || !Array.isArray(file.records)) throw new Error("Invalid memory file; refusing to overwrite it.");
  const ids = new Set<string>();
  for (const item of file.records) {
    if (!isRecord(item) || !exactKeys(item, ["userId", "key", "value", "sourceText", "evidence", "updatedAt"]) ||
        typeof item.userId !== "string" || item.key !== MEMORY_KEY ||
        !["brief", "detailed"].includes(String(item.value)) || typeof item.sourceText !== "string" ||
        typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("Invalid stored memory.");
    validateUserId(item.userId);
    validateCandidate({ value: item.value, evidence: item.evidence }, item.sourceText);
    const id = `${item.userId}:${item.key}`;
    if (ids.has(id)) throw new Error("Duplicate current memory for the same user and key.");
    ids.add(id);
  }
  return file as MemoryFile;
}

// 学习入口 3：只读当前用户、当前主题的一个偏好，不读取对方用户或整段聊天。
export async function readMemory(path: string, userId: string, topic: "code" | "other" = "code"): Promise<Memory | null> {
  validateUserId(userId);
  if (topic !== "code") return null;
  return (await readAll(path)).records.find(item => item.userId === userId && item.key === MEMORY_KEY) ?? null;
}

// 学习入口 4：用户 ID 来自程序，不来自模型。纠错更新同一条记录，不增加矛盾的当前值。
// 把模型提取的新偏好，与文件里的旧偏好比较。
export async function applyCandidate(path: string, userId: string, input: unknown, sourceText: string) {
  validateUserId(userId);
  // 经过校验的新候选。
  const candidate = validateCandidate(input, sourceText);
  const file = await readAll(path);
  // 同一个用户、同一个偏好字段在记录数组中的位置；-1 表示没找到。
  const position = file.records.findIndex(item => item.userId === userId && item.key === MEMORY_KEY);
  // 找到的旧记录；没有就是 null。
  const previous = file.records[position] ?? null;
  // 没有新偏好，或者偏好没变，就不操作
  if (candidate.value === "none" || candidate.value === previous?.value) {
    return { action: "NOOP" as const, previous, current: previous };
  }
  // 确实需要保存，再区分新增和更新
  const current: Memory = {
    userId, key: MEMORY_KEY, value: candidate.value, sourceText,
    evidence: candidate.evidence, updatedAt: new Date().toISOString(),
  };
  // 没找到旧记录：往数组里加一条，属于 ADD。
  if (position === -1) file.records.push(current);
  // 找到了旧记录：把那个位置替换成新记录，属于 UPDATE。
  else file.records[position] = current;
  // saveJson：把修改后的内容真正写进文件。只改数组，还不算落盘保存。
  await saveJson(path, file);
  return { action: previous ? "UPDATE" as const : "ADD" as const, previous, current };
}
