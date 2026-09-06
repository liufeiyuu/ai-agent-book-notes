import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "./config";
import { record, validDate, type Chunk, type PolicyDocument } from "./types";

export const MAX_CHUNK_CHARS = 600; // Character budget, NOT model token count.

export async function loadDocuments(directory = resolve(PROJECT_ROOT, "fixtures/policies")): Promise<PolicyDocument[]> {
  const manifest: unknown = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("Policy manifest must be a non-empty array.");
  const ids = new Set<string>();
  const documents: PolicyDocument[] = [];
  for (const entry of manifest) {
    if (!record(entry)) throw new Error("Invalid policy metadata.");
    for (const key of ["id", "file", "title", "version", "category", "channel"]) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) throw new Error(`Missing metadata: ${key}`);
    }
    if (!/^[a-z0-9-]+\.md$/.test(entry.file as string)) throw new Error("Policy file must be a plain Markdown filename.");
    if (!validDate(entry.publishedAt) || !validDate(entry.effectiveFrom) ||
        !(entry.effectiveUntil === null || validDate(entry.effectiveUntil))) throw new Error("Invalid policy dates.");
    if (entry.effectiveUntil !== null && entry.effectiveUntil <= entry.effectiveFrom) throw new Error("Invalid effective interval.");
    if (ids.has(entry.id as string)) throw new Error("Duplicate policy ID.");
    ids.add(entry.id as string);
    documents.push({ ...(entry as unknown as Omit<PolicyDocument, "text">), text: await readFile(resolve(directory, entry.file as string), "utf8") });
  }
  return documents.sort((a, b) => a.id.localeCompare(b.id));
}

// 学习入口 2：按 Markdown 小节分块，保留完整段落；元数据随每个块进入索引。
export function chunkDocument(document: PolicyDocument, maxChars = MAX_CHUNK_CHARS): Chunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("Invalid chunk size.");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current = { heading: "正文", lines: [] as string[] };
  for (const line of document.text.split(/\r?\n/)) {
    if (/^# /.test(line)) continue;
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading) { sections.push(current); current = { heading: heading[1]!, lines: [] }; }
    else current.lines.push(line);
  }
  sections.push(current);
  const chunks: Chunk[] = [];
  for (const section of sections) {
    let paragraphs: string[] = [];
    const flush = () => {
      if (!paragraphs.length) return;
      chunks.push({
        id: `${document.id}#${chunks.length + 1}`, documentId: document.id,
        source: `fixtures/policies/${document.file}`, title: document.title, section: section.heading,
        text: paragraphs.join("\n\n"), version: document.version, category: document.category,
        channel: document.channel, effectiveFrom: document.effectiveFrom, effectiveUntil: document.effectiveUntil,
      });
      paragraphs = [];
    };
    for (const paragraph of section.lines.join("\n").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) {
      // Refuse silent loss of conditions; long paragraphs need explicit restructuring.
      if (paragraph.length > maxChars) throw new Error(`Paragraph exceeds ${maxChars} characters in ${document.file}; split it explicitly.`);
      if ([...paragraphs, paragraph].join("\n\n").length > maxChars) flush();
      paragraphs.push(paragraph);
    }
    flush();
  }
  if (!chunks.length) throw new Error(`No content in ${document.file}.`);
  return chunks;
}

export function embeddingText(chunk: Chunk): string {
  return `${chunk.title}\n${chunk.section}\n品类：${chunk.category}；渠道：${chunk.channel}\n${chunk.text}`;
}

export function corpusFingerprint(chunks: Chunk[], model: string): string {
  return createHash("sha256").update(JSON.stringify({ schema: 1, chunker: "headings-paragraphs-v1", model, chunks })).digest("hex");
}

export async function loadChunks(): Promise<Chunk[]> {
  return (await loadDocuments()).flatMap(document => chunkDocument(document));
}
