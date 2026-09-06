export interface PolicyDocument {
  id: string;
  file: string;
  title: string;
  version: string;
  category: string;
  channel: string;
  publishedAt: string;
  effectiveFrom: string;
  effectiveUntil: string | null; // Exclusive; null means no known end.
  text: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  source: string;
  title: string;
  section: string;
  text: string;
  version: string;
  category: string;
  channel: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface IndexArtifact {
  schemaVersion: 1;
  embeddingModel: string;
  dimension: number;
  fingerprint: string;
  createdAt: string;
  entries: Array<{ chunk: Chunk; vector: number[] }>;
}

export interface Order {
  id: string;
  userId: string;
  product: string;
  category: string;
  channel: string;
  purchasedAt: string;
  deliveredAt: string;
  opened: boolean;
  accessoriesComplete: boolean;
  damaged: boolean;
  qualityIssue: boolean;
}

export interface SearchScope {
  category: string;
  channel: string;
  policyDate: string; // These fixtures explicitly use purchase date.
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
  rank: number;
}

export interface SearchTrace {
  query: string;
  scope: SearchScope;
  topK: number;
  embeddingModel: string;
  excluded: Array<{ chunkId: string; reason: string }>;
  ranking: Array<{ chunkId: string; score: number; rank: number }>;
  hits: SearchHit[];
  queryUsage: unknown;
}

export type AnswerStatus = "eligible" | "ineligible" | "needs_clarification" | "insufficient_evidence";
export interface Answer {
  status: AnswerStatus;
  orderIds: string[];
  answer: string;
  citations: Array<{ chunkId: string; quote: string }>;
  missingInformation: string[];
}

export interface Embedder {
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; usage: unknown }>;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
