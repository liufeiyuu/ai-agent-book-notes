import { validDate, type Chunk, type Embedder, type IndexArtifact, type SearchScope, type SearchTrace } from "./types";
import { validateVector } from "./provider";

export function exclusionReason(chunk: Chunk, scope: SearchScope): string | null {
  if (!validDate(scope.policyDate)) throw new Error("Invalid policy date.");
  if (chunk.category !== scope.category) return "category_mismatch";
  if (chunk.channel !== scope.channel) return "channel_mismatch";
  if (scope.policyDate < chunk.effectiveFrom) return "not_effective_yet";
  if (chunk.effectiveUntil !== null && scope.policyDate >= chunk.effectiveUntil) return "not_effective_for_this_order";
  return null;
}

export function cosine(left: number[], right: number[]): number {
  validateVector(left);
  validateVector(right, left.length);
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < left.length; i++) { dot += left[i]! * right[i]!; a += left[i]! ** 2; b += right[i]! ** 2; }
  const result = dot / Math.sqrt(a * b);
  if (!Number.isFinite(result)) throw new Error("Vector magnitude is not representable.");
  return result;
}

// 学习入口 3：先以订单事实限定适用范围，再计算真实向量相似度并选择 Top-K。
export async function retrieve(query: string, scope: SearchScope, index: IndexArtifact,
  embedder: Embedder, topK = 3, signal?: AbortSignal): Promise<SearchTrace> {
  if (!query.trim() || query.length > 2000) throw new Error("Query must contain 1–2000 characters.");
  if (!Number.isInteger(topK) || topK < 1 || topK > 10) throw new Error("Top-K must be between 1 and 10.");
  if (index.embeddingModel !== embedder.model) throw new Error("Query and document embedding models differ.");
  const excluded: SearchTrace["excluded"] = [];
  const candidates = index.entries.filter(entry => {
    const reason = exclusionReason(entry.chunk, scope);
    if (reason) excluded.push({ chunkId: entry.chunk.id, reason });
    return !reason;
  });
  if (!candidates.length) return { query, scope, topK, embeddingModel: embedder.model, excluded, ranking: [], hits: [], queryUsage: null };
  const { vectors, usage } = await embedder.embed([query], signal);
  if (vectors.length !== 1) throw new Error("Expected one query embedding.");
  const vector = vectors[0]!;
  validateVector(vector, index.dimension);
  const ranked = candidates.map(entry => ({ chunk: entry.chunk, score: cosine(vector, entry.vector), rank: 0 }))
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .map((item, i) => ({ ...item, rank: i + 1 }));
  return { query, scope, topK, embeddingModel: embedder.model, excluded,
    ranking: ranked.map(item => ({ chunkId: item.chunk.id, score: item.score, rank: item.rank })),
    hits: ranked.slice(0, topK), queryUsage: usage };
}
