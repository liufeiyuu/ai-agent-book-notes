import { type Answer, type AnswerStatus, type SearchHit } from "./types";
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
