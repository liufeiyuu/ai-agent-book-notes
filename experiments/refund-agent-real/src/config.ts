import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const INDEX_PATH = resolve(PROJECT_ROOT, "data/index.json");
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const DEMO_TODAY = "2026-09-06"; // Fixed business clock makes fixture expectations reproducible.

// Read only explicitly scoped local config; shell environment has priority.
// Deliberately no shell evaluation, interpolation, or logging of values.
export async function loadSettings(): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};
  for (const file of [resolve(PROJECT_ROOT, "../minimal-agent-ts/.env"), resolve(PROJECT_ROOT, ".env")]) {
    let body: string;
    try { body = await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1]!;
      let value = match[2]!;
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      } else { value = value.replace(/\s+#.*$/, "").trim(); }
      if (value) settings[key] = value;
    }
  }
  for (const key of ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "MODEL_NAME", "OPENROUTER_EMBEDDING_MODEL", "MAX_API_CALLS", "MAX_OUTPUT_TOKENS"]) {
    const value = process.env[key];
    if (value?.trim()) settings[key] = value.trim();
  }
  return settings;
}

export function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Expected an integer between 1 and ${max}.`);
  return parsed;
}

export function requireKey(settings: Record<string, string>): string {
  const key = settings.OPENROUTER_API_KEY;
  if (!key || key.includes("replace-with")) {
    throw new Error("Missing OPENROUTER_API_KEY. Configure refund-agent-real/.env locally; no mock fallback is used.");
  }
  return key;
}

export function requireChatModel(settings: Record<string, string>): string {
  const model = settings.OPENROUTER_MODEL ?? settings.MODEL_NAME;
  if (!model) throw new Error("Set OPENROUTER_MODEL to a tool-calling model available to your account.");
  return model;
}
