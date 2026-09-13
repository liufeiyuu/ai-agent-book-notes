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
  // 左边：旧索引里保存的指纹。
  // 右边：根据当前政策生成的块、当前模型重新计算的指纹。
  // 不一致：旧索引不能继续使用。
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
  // 读取索引，重新计算当前指纹，并进行比较
  // 政策更新：比较“当前内容”和“建索引时的内容”
  return validateIndex(JSON.parse(text), chunks, model);
}

// 向量与索引：先把块变成数字，再保留对应关系
export async function buildIndex(chunks: Chunk[], embedder: Embedder, path = INDEX_PATH): Promise<{ index: IndexArtifact; cacheHit: boolean; usage: unknown }> {
  if (!chunks.length) throw new Error("Cannot index an empty corpus.");
  try { return { index: await readIndex(chunks, embedder.model, path), cacheHit: true, usage: null }; }
  catch { /* Derived local index may be missing, stale, or invalid. Rebuild from source. */ }
  // chunks.map(embeddingText)：把每个块整理成送给 Embedding 模型的文字。
  // embedder.embed(...)：取得这些文字对应的向量。
  const { vectors, usage } = await embedder.embed(chunks.map(embeddingText));
  if (vectors.length !== chunks.length) throw new Error("Embedding count mismatch.");
  const dimension = vectors[0]?.length;
  for (const vector of vectors) validateVector(vector, dimension);
  const index: IndexArtifact = {
    schemaVersion: 1, embeddingModel: embedder.model, dimension: dimension!,
    // 建索引时，程序保存一个指纹
    // 可以把指纹理解为：根据这批块和 Embedding 模型计算出来的内容标识。 它不是语义相似度分数。
    fingerprint: corpusFingerprint(chunks, embedder.model), createdAt: new Date().toISOString(),
    // 拿到向量后程序配对，意思是：第 i 个块，配上第 i 个向量。
    entries: chunks.map((chunk, i) => ({ chunk, vector: vectors[i]! })),
  };
  // 将整个索引保存在本地的索引文件 experiments/refund-agent-real/data/index.json
  // 这个项目的索引就是一个本地 JSON 文件，没有另外接入向量数据库。
  await saveJson(path, index);
  return { index, cacheHit: false, usage };
}
