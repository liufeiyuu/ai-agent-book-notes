import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { corpusFingerprint, embeddingText } from "./corpus";
import { INDEX_PATH } from "./config";
import { validateVector } from "./provider";
import { record, type Chunk, type Embedder, type IndexArtifact } from "./types";

export async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export function validateIndex(value: unknown, chunks: Chunk[], model: string): IndexArtifact {
  if (!record(value) || value.schemaVersion !== 1 || value.embeddingModel !== model ||
      value.fingerprint !== corpusFingerprint(chunks, model) || !Array.isArray(value.entries) ||
      value.entries.length !== chunks.length || !Number.isInteger(value.dimension) || (value.dimension as number) < 1) {
    throw new Error("Index is missing, stale, or uses a different embedding model. Run npm run index.");
  }
  for (const [i, entry] of value.entries.entries()) {
    if (!record(entry) || JSON.stringify(entry.chunk) !== JSON.stringify(chunks[i])) throw new Error("Index chunk metadata mismatch. Rebuild the index.");
    validateVector(entry.vector, value.dimension as number);
  }
  return value as unknown as IndexArtifact;
}

export async function readIndex(chunks: Chunk[], model: string, path = INDEX_PATH): Promise<IndexArtifact> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No index yet. Run npm run index."); throw error; }
  return validateIndex(JSON.parse(text), chunks, model);
}

export async function buildIndex(chunks: Chunk[], embedder: Embedder, path = INDEX_PATH): Promise<{ index: IndexArtifact; cacheHit: boolean; usage: unknown }> {
  if (!chunks.length) throw new Error("Cannot index an empty corpus.");
  try { return { index: await readIndex(chunks, embedder.model, path), cacheHit: true, usage: null }; }
  catch { /* Derived local index may be missing, stale, or invalid. Rebuild from source. */ }
  const { vectors, usage } = await embedder.embed(chunks.map(embeddingText));
  if (vectors.length !== chunks.length) throw new Error("Embedding count mismatch.");
  const dimension = vectors[0]?.length;
  for (const vector of vectors) validateVector(vector, dimension);
  const index: IndexArtifact = {
    schemaVersion: 1, embeddingModel: embedder.model, dimension: dimension!,
    fingerprint: corpusFingerprint(chunks, embedder.model), createdAt: new Date().toISOString(),
    entries: chunks.map((chunk, i) => ({ chunk, vector: vectors[i]! })),
  };
  await saveJson(path, index);
  return { index, cacheHit: false, usage };
}
