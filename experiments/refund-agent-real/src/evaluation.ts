import { type Answer, type AnswerStatus, type SearchHit, type SearchTrace } from "./types";
import { parseAnswer } from "./answer";
export { parseAnswer } from "./answer";

export interface Case {
  id: string;
  question: string;
  orderId?: string;
  expectedStatus: AnswerStatus;
  requiredDocument?: string;
  requiredChunkId?: string;
}

// Gold labels live only in evaluation; none of these expectations enter model prompts.
export const CASES: Case[] = [
  { id: "normal", question: "订单 H1001 的耳罩式耳机外包装拆了，配件都在，没损坏，能退吗？", orderId: "H1001", expectedStatus: "eligible", requiredDocument: "headphones-v2", requiredChunkId: "headphones-v2#1" },
  { id: "paraphrase", question: "H1001 那个戴在头上的黑色听歌设备，盒子打开了但东西都齐，想寄回去拿回钱，可以吗？", orderId: "H1001", expectedStatus: "eligible", requiredDocument: "headphones-v2", requiredChunkId: "headphones-v2#1" },
  { id: "historical", question: "H1002 签收十二天了，盒子拆了但配件完整也没有损坏，还能退吗？请按这笔订单适用的政策判断。", orderId: "H1002", expectedStatus: "eligible", requiredDocument: "headphones-v1", requiredChunkId: "headphones-v1#1" },
  { id: "missing", question: "B1003 骨传导耳机已经拆封，能退吗？", orderId: "B1003", expectedStatus: "insufficient_evidence" },
  { id: "ambiguous", question: "帮我看看上次买的那个耳机，拆封了还能退吗？", expectedStatus: "needs_clarification" },
  { id: "exception", question: "E1004 入耳式耳机卫生封条拆开了，没有质量问题，能无理由退货吗？", orderId: "E1004", expectedStatus: "ineligible", requiredDocument: "earbuds-v1", requiredChunkId: "earbuds-v1#1" },
];

export type PolicySearchObservation = Pick<SearchTrace, "scope" | "query" | "ranking">;

// B2 第 2 站：读取已保存的成功搜索，事后检查“查明无候选后是否还在搜索”。
// 同一次咨询使用固定索引。候选由品类、渠道、购买日期决定，换搜索词不会新增候选。
// ranking 保存全部适用候选，hits 只是 Top-K；不能把二者混为一谈。
export function evaluatePolicySearches(searches: readonly PolicySearchObservation[]) {
  // 每次评测新建这张表，只记本次咨询，不把上一位用户或上次运行的空结果带进来。
  // key 是业务范围；value 是首次查到零候选的搜索序号（从 1 开始）。
  const emptyScopes = new Map<string, number>();
  const violations: Array<{ firstEmptySearch: number; repeatedSearch: number }> = [];
  searches.forEach((search, index) => {
    const { category, channel, policyDate } = search.scope;
    // B1003 的 key 为 '["bone-conduction","official","2026-09-02"]'。
    // 故意不包含 query：同一范围即使换搜索词，仍应查到同一条“曾经为空”的记录。
    const key = JSON.stringify([category, channel, policyDate]);
    const firstEmptySearch = emptyScopes.get(key);
    // 只看成功返回的检索记录；工具异常不会进入 searches，不等同于候选为 0。
    if (firstEmptySearch !== undefined) {
      // 已经知道这个范围没有候选，此次仍搜索它：记下首次空查询与本次重复的序号。
      // 旧 B1003 的第 2、3 次搜索分别产生 {1, 2}、{1, 3}；不覆盖最初的序号 1。
      violations.push({ firstEmptySearch, repeatedSearch: index + 1 });
    } else if (search.ranking.length === 0) {
      // 第一次查到空结果本身合法：只登记，不记违规。index 从 0 开始，因此加 1。
      emptyScopes.set(key, index + 1);
    }
    // 尚未查明该范围为空、且本次仍有候选时，不限制后续补查。
  });
  // 没有违规只表示通过这一项；searches 为空也会通过，必需查询是否做过由其他检查负责。
  // 返回报告供 runner 合并，不在这里重新调用模型、重做检索或阻止已经发生的动作。
  return { name: "no_search_after_empty_candidates", passed: violations.length === 0, violations };
}

// 学习入口 6：引用必须来自实际送给模型的块；字符串出现本身并不证明语义支持。
export function evaluateAnswer(raw: string, hits: SearchHit[], knownOrderIds: string[], expected?: Case) {
  const checks: Array<{ name: string; passed: boolean }> = [];
  let answer: Answer;
  try { answer = parseAnswer(raw); }
  catch { return { automatedPassed: false, checks: [{ name: "answer_schema", passed: false }], answer: null, requiresHumanReview: true }; }
  checks.push({ name: "answer_schema", passed: true });
  const evidence = new Map(hits.map(hit => [hit.chunk.id, hit.chunk]));
  checks.push({ name: "known_orders_only", passed: answer.orderIds.every(id => knownOrderIds.includes(id)) });
  // c.chunkId：这条引用声称来自哪个块。
  // evidence.get(...)：从本次实际检索到的证据里找到那个块。
  // .text.includes(c.quote)：检查引用文字是否出现在该块原文中。
  // 字符串匹配发现引用对不上原文。 找不到对应的块，也不会通过。
  checks.push({ name: "citation_ids_and_quotes", passed: answer.citations.every(c => evidence.get(c.chunkId)?.text.includes(c.quote) === true) });
  // 确定性的退货判断，是否带有证据？
  const decisive = answer.status === "eligible" || answer.status === "ineligible";
  // 如果回答不是 eligible 或 ineligible，这一项不强求引用。
  // 如果回答是 eligible 或 ineligible，必须同时满足：至少一条引用，而且明确针对一笔订单。
  // 不过，这项检查也只是检查“有没有引用”，并不能单独证明引用真正支持结论。
  checks.push({ name: "decision_has_evidence", passed: !decisive || (answer.citations.length > 0 && answer.orderIds.length === 1) });
  // 如果是确定结论，这一项不要求填写缺失信息；如果是不确定结论，missingInformation 至少要有一项。
  // 注意代码实际只看了数组里有没有内容，并没有核对内容是否符合实际。
  checks.push({ name: "uncertainty_has_explanation", passed: decisive || answer.missingInformation.length > 0 });
  if (expected) {
    checks.push({ name: "expected_decision", passed: answer.status === expected.expectedStatus });
    if (expected.orderId) checks.push({ name: "target_order", passed: answer.orderIds.length === 1 && answer.orderIds[0] === expected.orderId });
    if (expected.requiredDocument) checks.push({ name: "expected_policy_cited", passed: answer.citations.some(c => evidence.get(c.chunkId)?.documentId === expected.requiredDocument) });
    if (expected.requiredChunkId) {
      checks.push({ name: "relevant_chunk_retrieved", passed: evidence.has(expected.requiredChunkId) });
      checks.push({ name: "expected_chunk_cited", passed: answer.citations.some(c => c.chunkId === expected.requiredChunkId) });
    }
  }
  return { automatedPassed: checks.every(check => check.passed), checks, answer, requiresHumanReview: true };
}
