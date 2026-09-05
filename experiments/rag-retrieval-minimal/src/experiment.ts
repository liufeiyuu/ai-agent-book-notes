import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOP_K = 2;

export type DocumentStatus = "active" | "superseded" | "not_applicable";
export type StrategyName = "sparse" | "semantic_proxy" | "hybrid_rerank";

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  year: number;
  status: DocumentStatus;
  semanticConcepts: string[];
}

export interface QueryCase {
  id: string;
  query: string;
  goldDocumentId: string;
  semanticConcepts: string[];
  requiresCurrentVersion: boolean;
  staleDocumentId?: string;
}

export interface RankingSignals {
  sparseScore: number;
  semanticScore: number;
  rrfScore: number;
  identifierBoost: number;
  freshnessBoost: number;
}

export interface RankedDocument {
  rank: number;
  documentId: string;
  title: string;
  score: number;
  status: DocumentStatus;
  signals: RankingSignals;
}

export interface QueryResult {
  queryId: string;
  query: string;
  goldDocumentId: string;
  topK: number;
  goldRank: number;
  recallAtK: boolean;
  reciprocalRank: number;
  freshnessPassed: boolean | null;
  ranking: RankedDocument[];
}

export interface StrategyResult {
  strategy: StrategyName;
  recallAtK: number;
  meanReciprocalRank: number;
  freshnessPassed: boolean;
  passesAllConditions: boolean;
  queries: QueryResult[];
}

export interface ExperimentResult {
  topK: number;
  corpus: KnowledgeDocument[];
  queryCases: QueryCase[];
  strategies: StrategyResult[];
  limitations: string[];
}

// 第一站：同一份知识库包含精确代码、语义改写、现行政策和过期政策。
export function buildCorpus(): KnowledgeDocument[] {
  return [
    {
      id: "account-profile-edit",
      title: "账号资料修改指南",
      content: "账号昵称、头像和联系方式可以在个人设置页面修改。",
      year: 2026,
      status: "active",
      semanticConcepts: ["account-profile"],
    },
    {
      id: "generic-server-error",
      title: "服务器错误通用排查",
      content: "遇到技术错误时，先检查服务器状态并查看通用故障日志。",
      year: 2026,
      status: "active",
      semanticConcepts: ["technical-error", "server-troubleshooting"],
    },
    {
      id: "guide-login-failure",
      title: "用户登录失败处理指南",
      content: "当使用者无法进入个人账户时，先重置密码，再检查登录保护状态。",
      year: 2026,
      status: "active",
      semanticConcepts: ["authentication", "account-access"],
    },
    {
      id: "refund-policy-2024",
      title: "2024 年退款政策",
      content: "退款期限：订单签收后 30 天内可以申请退款。此版本已经废止。",
      year: 2024,
      status: "superseded",
      semanticConcepts: ["refund", "return-window", "policy"],
    },
    {
      id: "refund-policy-2026",
      title: "2026 年退款政策",
      content: "退款期限：订单签收后 7 天内可以申请退款。此版本当前有效。",
      year: 2026,
      status: "active",
      semanticConcepts: ["refund", "return-window", "policy"],
    },
    {
      id: "runbook-http-403",
      title: "HTTP-403 权限错误处理手册",
      content: "HTTP-403 表示访问被拒绝。请检查 API Key、权限范围和资源策略。",
      year: 2026,
      status: "active",
      semanticConcepts: ["authorization", "api-credential"],
    },
  ];
}

export function buildQueries(): QueryCase[] {
  return [
    {
      id: "exact_identifier",
      query: "HTTP-403 怎么处理？",
      goldDocumentId: "runbook-http-403",
      semanticConcepts: ["technical-error", "server-troubleshooting"],
      requiresCurrentVersion: false,
    },
    {
      id: "semantic_paraphrase",
      query: "账号进不去了怎么办？",
      goldDocumentId: "guide-login-failure",
      semanticConcepts: ["authentication", "account-access"],
      requiresCurrentVersion: false,
    },
    {
      id: "fresh_policy",
      query: "现在退款期限是多少？",
      goldDocumentId: "refund-policy-2026",
      semanticConcepts: ["refund", "return-window", "policy"],
      requiresCurrentVersion: true,
      staleDocumentId: "refund-policy-2024",
    },
  ];
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const asciiTokens = normalized.match(/[a-z]+(?:-[a-z0-9]+)+|[a-z0-9]+/g) ?? [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const chineseBigrams = chineseRuns.flatMap((run) => {
    if (run.length < 2) {
      return [run];
    }

    return Array.from(
      { length: run.length - 1 },
      (_, index) => run.slice(index, index + 2),
    );
  });

  return [...asciiTokens, ...chineseBigrams];
}

function countOccurrences(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

// 第二站 A：一个可运行的 BM25 风格稀疏检索器，只使用字面 token。
export function sparseScores(
  query: QueryCase,
  corpus: KnowledgeDocument[],
): Map<string, number> {
  const queryTokens = [...new Set(tokenize(query.query))];
  const documentTokens = corpus.map((document) =>
    tokenize(`${document.title} ${document.content}`),
  );
  const averageLength =
    documentTokens.reduce((sum, tokens) => sum + tokens.length, 0) /
    documentTokens.length;
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<string, number>();

  corpus.forEach((document, documentIndex) => {
    const tokens = documentTokens[documentIndex] ?? [];
    const termCounts = countOccurrences(tokens);
    let score = 0;

    for (const queryToken of queryTokens) {
      const documentFrequency = documentTokens.filter((candidateTokens) =>
        candidateTokens.includes(queryToken),
      ).length;
      if (documentFrequency === 0) {
        continue;
      }

      const termFrequency = termCounts.get(queryToken) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 +
          (corpus.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );
      const lengthNormalization =
        termFrequency +
        k1 * (1 - b + b * (tokens.length / averageLength));
      score +=
        inverseDocumentFrequency *
        ((termFrequency * (k1 + 1)) / lengthNormalization);
    }

    scores.set(document.id, score);
  });

  return scores;
}

function cosineForConcepts(left: string[], right: string[]): number {
  const dimensions = [...new Set([...left, ...right])];
  if (dimensions.length === 0) {
    return 0;
  }

  const leftValues = dimensions.map((dimension) =>
    left.includes(dimension) ? 1 : 0,
  );
  const rightValues = dimensions.map((dimension) =>
    right.includes(dimension) ? 1 : 0,
  );
  const dotProduct = leftValues.reduce<number>(
    (sum, value, index) => sum + value * (rightValues[index] ?? 0),
    0,
  );
  const leftMagnitude = Math.sqrt(
    leftValues.reduce<number>((sum, value) => sum + value * value, 0),
  );
  const rightMagnitude = Math.sqrt(
    rightValues.reduce<number>((sum, value) => sum + value * value, 0),
  );

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dotProduct / (leftMagnitude * rightMagnitude);
}

// 第二站 B：用人工概念标签代理稠密向量，展示语义召回机制，不冒充真实 Embedding。
export function semanticProxyScores(
  query: QueryCase,
  corpus: KnowledgeDocument[],
): Map<string, number> {
  return new Map(
    corpus.map((document) => [
      document.id,
      cosineForConcepts(query.semanticConcepts, document.semanticConcepts),
    ]),
  );
}

function emptySignals(): RankingSignals {
  return {
    sparseScore: 0,
    semanticScore: 0,
    rrfScore: 0,
    identifierBoost: 0,
    freshnessBoost: 0,
  };
}

function rankByScore(
  corpus: KnowledgeDocument[],
  scores: Map<string, number>,
  signalName: "sparseScore" | "semanticScore",
): RankedDocument[] {
  return corpus
    .map((document) => {
      const score = scores.get(document.id) ?? 0;
      return {
        rank: 0,
        documentId: document.id,
        title: document.title,
        score,
        status: document.status,
        signals: { ...emptySignals(), [signalName]: score },
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.documentId.localeCompare(right.documentId),
    )
    .map((document, index) => ({ ...document, rank: index + 1 }));
}

export function sparseRank(
  query: QueryCase,
  corpus: KnowledgeDocument[],
): RankedDocument[] {
  return rankByScore(corpus, sparseScores(query, corpus), "sparseScore");
}

export function semanticProxyRank(
  query: QueryCase,
  corpus: KnowledgeDocument[],
): RankedDocument[] {
  return rankByScore(
    corpus,
    semanticProxyScores(query, corpus),
    "semanticScore",
  );
}

function rankPositions(ranking: RankedDocument[]): Map<string, number> {
  return new Map(ranking.map((document) => [document.documentId, document.rank]));
}

function exactIdentifiers(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+-[0-9]+/g) ?? [];
}

// 第二站 C：RRF 融合两路排名，再用精确标识符、语义相关性和版本状态重排。
export function hybridRerank(
  query: QueryCase,
  corpus: KnowledgeDocument[],
): RankedDocument[] {
  const sparse = sparseRank(query, corpus);
  const semantic = semanticProxyRank(query, corpus);
  const sparsePositions = rankPositions(sparse);
  const semanticPositions = rankPositions(semantic);
  const sparseById = new Map(sparse.map((item) => [item.documentId, item]));
  const semanticById = new Map(semantic.map((item) => [item.documentId, item]));
  const identifiers = exactIdentifiers(query.query);
  const rrfK = 60;

  return corpus
    .map((document) => {
      const sparseRankPosition = sparsePositions.get(document.id) ?? corpus.length;
      const semanticRankPosition =
        semanticPositions.get(document.id) ?? corpus.length;
      const sparseScore = sparseById.get(document.id)?.score ?? 0;
      const semanticScore = semanticById.get(document.id)?.score ?? 0;
      const rrfScore =
        1 / (rrfK + sparseRankPosition) +
        1 / (rrfK + semanticRankPosition);
      const documentText = `${document.title} ${document.content}`.toLowerCase();
      const identifierBoost = identifiers.some((identifier) =>
        documentText.includes(identifier),
      )
        ? 0.2
        : 0;
      const freshnessBoost =
        query.requiresCurrentVersion && semanticScore > 0
        ? document.status === "active"
          ? 0.03
          : document.status === "superseded"
            ? -0.03
            : 0
        : 0;
      const score =
        rrfScore + identifierBoost + semanticScore * 0.04 + freshnessBoost;

      return {
        rank: 0,
        documentId: document.id,
        title: document.title,
        score,
        status: document.status,
        signals: {
          sparseScore,
          semanticScore,
          rrfScore,
          identifierBoost,
          freshnessBoost,
        },
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.documentId.localeCompare(right.documentId),
    )
    .map((document, index) => ({ ...document, rank: index + 1 }));
}

// 第三站：先评价检索证据是否出现，再评价是否把现行版本排在旧版本之前。
export function evaluateRanking(
  query: QueryCase,
  ranking: RankedDocument[],
  topK = TOP_K,
): QueryResult {
  const gold = ranking.find(
    (document) => document.documentId === query.goldDocumentId,
  );
  if (!gold) {
    throw new Error(`Gold document not found: ${query.goldDocumentId}`);
  }

  let freshnessPassed: boolean | null = null;
  if (query.requiresCurrentVersion && query.staleDocumentId) {
    const stale = ranking.find(
      (document) => document.documentId === query.staleDocumentId,
    );
    freshnessPassed = stale ? gold.rank < stale.rank : true;
  }

  return {
    queryId: query.id,
    query: query.query,
    goldDocumentId: query.goldDocumentId,
    topK,
    goldRank: gold.rank,
    recallAtK: gold.rank <= topK,
    reciprocalRank: 1 / gold.rank,
    freshnessPassed,
    ranking,
  };
}

function runStrategy(
  strategy: StrategyName,
  queries: QueryCase[],
  corpus: KnowledgeDocument[],
): StrategyResult {
  const ranker =
    strategy === "sparse"
      ? sparseRank
      : strategy === "semantic_proxy"
        ? semanticProxyRank
        : hybridRerank;
  const queryResults = queries.map((query) =>
    evaluateRanking(query, ranker(query, corpus)),
  );
  const recallAtK =
    queryResults.filter((result) => result.recallAtK).length /
    queryResults.length;
  const meanReciprocalRank =
    queryResults.reduce((sum, result) => sum + result.reciprocalRank, 0) /
    queryResults.length;
  const freshnessPassed = queryResults.every(
    (result) => result.freshnessPassed !== false,
  );

  return {
    strategy,
    recallAtK,
    meanReciprocalRank,
    freshnessPassed,
    passesAllConditions: recallAtK === 1 && freshnessPassed,
    queries: queryResults,
  };
}

export function runExperiment(): ExperimentResult {
  const corpus = buildCorpus();
  const queryCases = buildQueries();
  const strategies: StrategyName[] = [
    "sparse",
    "semantic_proxy",
    "hybrid_rerank",
  ];

  return {
    topK: TOP_K,
    corpus,
    queryCases,
    strategies: strategies.map((strategy) =>
      runStrategy(strategy, queryCases, corpus),
    ),
    limitations: [
      "Semantic retrieval uses hand-authored concept labels rather than a real embedding model.",
      "The corpus and queries are synthetic and intentionally expose complementary failure modes.",
      "The experiment evaluates retrieval rankings, not an LLM generator or end-to-end answer quality.",
    ],
  };
}

function printResults(result: ExperimentResult): void {
  console.table(
    result.strategies.map((strategy) => ({
      strategy: strategy.strategy,
      [`recall@${result.topK}`]: `${(strategy.recallAtK * 100).toFixed(1)}%`,
      mrr: strategy.meanReciprocalRank.toFixed(3),
      freshness: strategy.freshnessPassed,
      allPassed: strategy.passesAllConditions,
    })),
  );

  for (const strategy of result.strategies) {
    console.log(`\n[${strategy.strategy}]`);
    console.table(
      strategy.queries.map((query) => ({
        query: query.queryId,
        goldRank: query.goldRank,
        recallAtK: query.recallAtK,
        freshness: query.freshnessPassed ?? "n/a",
        topDocuments: query.ranking
          .slice(0, result.topK)
          .map((document) => document.documentId)
          .join(", "),
      })),
    );
  }
}

function writeTrace(result: ExperimentResult): string {
  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../runs/latest-typescript.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return outputPath;
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const result = runExperiment();
  printResults(result);
  console.log(`\nTrace written to ${writeTrace(result)}`);
}
