# 真实运行记录：首次失败、修复与验收

日期：2026-09-06。业务时钟仍固定为 2026-09-06。

最新状态：教学范围实现已验收，最终固定 RAG 6/6、Agent 6/6，编译及 30 个离线测试通过。Agent 包含一次有界格式恢复，不是首次输出全部合规。先看文末[修复与最终验收](#修复与最终验收)，以下早期失败按时间顺序保留。

## 配置与实际结果

- 已确认本地凭据存在，不记录密钥内容。
- 聊天模型：`google/gemini-2.5-flash`；Embedding：`openai/text-embedding-3-small`。
- 5 份虚构政策切成 14 个块；初始没有向量索引。
- 沙箱内第一次 `npm run index` 返回 `fetch failed`。
- 经授权联网后，Embedding API 返回 HTTP 403。初版错误处理未保留服务端详情，因此增加了结构化错误提取和凭据脱敏，再发起一次诊断请求。
- 诊断请求仍为 HTTP 403，原始错误信息为：`The request is prohibited due to a violation of provider Terms Of Service.`
- 此后停止重试，未切换账户、凭据或模型绕过限制。错误消息本身不足以确定具体违反了哪项条款，也不能据此判断是余额或参数问题。

对应 Trace（本地文件，被 Git 忽略）：

1. `runs/2026-09-06T03-03-30-301Z-index-cce8fa28.json`：沙箱连接失败。
2. `runs/2026-09-06T03-03-44-177Z-index-1de135fa.json`：HTTP 403。
3. `runs/2026-09-06T03-04-22-141Z-index-94e09a41.json`：带明确错误详情的 HTTP 403。

API 调用计数记录的是尝试次数，不代表计费成功；费用以平台账单为准。

## 首次尝试的边界与下一步

文档 Embedding 请求被服务端拒绝，尚未取得真实向量。因此没有执行查询 Embedding、固定 RAG 的聊天请求或 Agent 工具循环；不能报告答案通过率或真实检索结果。

需要用户在 OpenRouter 后台核查账户与供应商访问限制，必要时联系支持，确认合规访问可用后再继续。恢复后顺序为：建立索引 → 一例固定 RAG → 同一例 Agent → 对照真实 Trace 学习，再开展更多案例。

修复仅增强可观察性，没有改索引算法、业务规则或评测标准。新增脱敏回归测试，TypeScript 编译和 21 个离线测试通过。

## 本次能学到的重点

失败应按实际发生阶段定位：这次失败发生在“文档文本 → Embedding API”，还没进入检索、构建回答上下文或生成。此时修改 Prompt、Top-K 或退款规则都不能解决已观察到的访问拒绝。

## 用户要求更换 Embedding 后的进展

同日，用户明确要求更换 Embedding 模型，现改为 `qwen/qwen3-embedding-8b`。同步更新了本地 `.env`、`.env.example` 和默认值，未修改密钥、账户或聊天模型。

- `npm run index` 成功：14 个块、4096 维，源指纹 `ecda00b7b8e0f5cc45d7a024a0f7208afbab496953002c1b233c4e1840315525`。
- 索引 Trace：`runs/2026-09-06T03-10-38-507Z-index-0d124591.json`。
- `npm run ask -- --case normal --mode rag`：查询 Embedding 成功；随后 Gemini 聊天接口返回 HTTP 403，原文为 `This model is not available in your region.`，停止重试。
- 回答尝试 Trace：`runs/2026-09-06T03-10-57-118Z-ask-09d60f47.json`。
- 从失败请求的实际 messages 核对，Top-3 是 `headphones-v2#2`、`headphones-v2#3`、`headphones-v2#4`，没有 `headphones-v2#1` 的关键期限与拆封条款。向量接口成功不等于检索质量达标；后续还需针对这条真实检索结果诊断，不能提前宣布正常案例通过。
- 编译和 21 个离线测试再次通过；没有真实最终回答，也未运行 Agent 模式或整套评测。

当前进展：原 Embedding 访问阻塞已通过用户授权选择其他模型解决；真实生成仍受所配置 Gemini 模型的地区限制。若继续端到端学习，需要用户确认更换聊天模型，另行检查召回质量。更换 Embedding 没有改变 OpenAI/Anthropic 的访问限制。

## 按用户要求接入 DeepSeek V4

用户要求聊天和 Embedding 都改为 DeepSeek V4。核对 [DeepSeek 模型目录](https://api-docs.deepseek.com/quick_start/pricing/)与 [OpenRouter Embedding 列表](https://openrouter.ai/api/v1/embeddings/models)后，未找到可调用的 DeepSeek Embedding 型号，因此只更换聊天模型，明确告知 Embedding 保留 Qwen。V4 聊天模型 ID 不能用于 `/embeddings`。

聊天选用 OpenRouter 的 `deepseek/deepseek-v4-flash-0731`（V4 Flash 正式版本），不是同平台未带日期的 0423 版本。同步本地 `.env`、示例和 README，未改变密钥或账户。Qwen 模型未变，复用已有索引，不重新向量化全文。

三次真实尝试：

1. `runs/2026-09-06T03-15-33-507Z-ask-bf97ce59.json`：固定 RAG；HTTP 200，但 `finish_reason=length` 且无最终文本。请求没有显式关闭思考，输出上限为 1500。未当作成功。
2. 为 V4 显式设置 `reasoning.enabled=false` 后，`runs/2026-09-06T03-16-28-880Z-ask-47479bd8.json` 返回合法 JSON、状态 `insufficient_evidence`。仍为 Top-3 的 #2/#3/#4，缺少 #1 期限与拆封条款，`expected_decision`、`relevant_chunk_retrieved`、`expected_chunk_cited` 失败。正常案例的最终业务目标未完成；缺证据时停止判断的行为可观察。
3. `runs/2026-09-06T03-16-51-662Z-ask-efca8e2f.json`：Agent 实际执行 `query_orders` 和 `search_policy`，拿到了 `headphones-v2#1`，在最终输出中给出 eligible 及对应原文。但 JSON 前夹带说明文字，严格 JSON 解析失败。`execution_completed`、`orders_actually_queried`、`policy_search_attempted` 通过，`answer_schema` 失败；未自动提取末尾 JSON 来规避失败。

非思考配置依据：[OpenRouter Reasoning 参数](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。该设置还避免第一周协议未回传 reasoning blocks 时的多轮兼容问题；不表示已实现思考模式下的工具循环。新增参数回归测试，编译和 22 个离线测试通过。

当前结论：真实 Embedding、聊天和工具循环已打通；固定 RAG 检索质量及 Agent 输出格式仍待诊断，六案例评测尚未运行。这里只验证更换后的模型接入，没有同时修改 Top-K、检索算法、业务 Prompt 或评测标准。

## 修复与最终验收

用户明确要求助手先完成实现和真实验收，再开展带学；以下工作是实现修复，不把失败当作刻意设计的教学题。

### 修复内容

1. 原 normal 查询的正确块 `headphones-v2#1` 在适用候选中排第 4，而非被业务过滤删除。按 [Qwen 官方模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-8B)补齐查询的 `Instruct: …\nQuery:…` 格式，任务指令说明检索退货条件、期限和例外；文档不加查询指令。修复后该查询关键块排第 1（余弦分数约 0.72794）。同一份真实索引、Top-3、业务过滤、案例与金标均保留，未塞入全部政策或按块 ID 加分。
2. API 请求增加严格 JSON Schema 和 `provider.require_parameters=true`，并保留严格本地解析；拒绝说明前缀、代码围栏、额外字段、类型错误和空引用。依据：[OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)。
3. 真实测试证实带工具请求仍可能不遵守格式（`runs/2026-09-06T03-28-25-080Z-ask-9b1a7fb3.json`）。因此为正常结束但格式失败的输出添加**最多一次无工具重生成**，只传本次已观察的订单与政策证据，不传金标、不截取旧输出中的 JSON。`formatRecovery` 保留失败稿及完整恢复请求/响应；仍失败或预算不足就失败。
4. 固定 RAG 的聊天错误不再丢掉成功检索的完整排名。订单查询检查区分“实际查过但无可访问结果”和“根本没调用”。空适用候选明确返回数量 0，并提示换搜索词不会产生政策；保留循环/时间/请求上限。
5. 初次完整 Agent 尝试前五例通过，第六例在 32 次共享请求上限处失败：`runs/2026-09-06T03-30-13-928Z-evaluate-434336d2.json`。这是程序保护，不是余额耗尽；没有删除失败结果。补充停止规则后，默认每进程上限调整为 40 次，完成重跑。预算不承诺所有输入必定可完成。

### 已完成的验收

- 编译：`npm run typecheck` 通过。
- 离线回归：`npm test`，30/30 通过。覆盖真实请求参数、Qwen 格式、严格解析、恢复上限、恢复不能引入新订单/金标、错误保存、空候选、权限隔离与循环停止；这些离线替身不作为真实效果证明。
- 修复后首次完整 RAG：6/6，10 次请求；`runs/2026-09-06T03-28-31-163Z-evaluate-342e9b7a.json`。
- 最终代码 RAG 复验：6/6，10/40 次请求，六例均未触发格式恢复；`runs/2026-09-06T03-36-37-249Z-evaluate-b7c3ff4a.json`。
- 最终代码 Agent：6/6，31/40 次请求，六例均触发一次格式恢复并通过最终检查；`runs/2026-09-06T03-36-23-063Z-evaluate-93c08974.json`。

| 案例 | RAG / Agent 最终状态 | 引用与订单事实逐例核对 |
| --- | --- | --- |
| normal | eligible / eligible | H1001 签收 2 天，v2 的 7 日期限内，外包装允许拆封、配件齐全且无损坏；引用 v2#1 |
| paraphrase | eligible / eligible | 改写商品称呼仍确认 H1001，条件与 v2#1 一致，没有因“盒子打开”拒绝 |
| historical | eligible / eligible | H1002 购买于 8 月 20 日，使用 v1 的 30 日规则，签收 12 天可申请；未误用当前 7 日规则 |
| missing | insufficient_evidence / insufficient_evidence | B1003 没有适用品类政策，明确缺少条款、无引用，未擅自允许退款；Agent 只查一次政策即停止 |
| ambiguous | needs_clarification / needs_clarification | 多个可访问耳机订单，请求确认，未擅自选择最新订单；Agent 没有提前查询任意订单政策 |
| exception | ineligible / ineligible | E1004 卫生封条拆开、无质量问题，对应 earbuds-v1#1 的无理由退货限制；没有误用外包装规则 |

上述最终回答已对照订单及引用正文逐例审阅：状态、主要条件和来源一致，没有宣称实际退款已经执行或到账。`requiresHumanReview` 仍保持 true，不用自动字符串检查取代语义审查。部分缺证据回答建议“稍后再试”，这并不保证稍后有新政策，客服话术仍有改进空间。

### 限制与学习交接

- 6 个合成案例是当前教学范围的功能验收，不是线上可靠率。Agent 首次输出格式问题仍存在于模型响应侧，由显式有界恢复处理；该轮不是“原生 JSON 成功率 100%”。
- 普通/改写案例仍各有一次冗余政策搜索，未达到最少调用数；本次没有展开性能优化。格式恢复也增加调用成本。
- 额外的私有订单号和指令冲突联网测试被安全审核拦截，未执行、未计入真实通过数；权限隔离有本地测试。后来补充只读证据证明标准六案例是虚构数据，原验收命令获准继续。
- 未进行真实退款、接入生产订单、增加持久记忆或部署服务；没有提交密钥、索引或原始 Trace。旧失败保留，不改金标。
- 下一步从已验收 normal 的固定 RAG Trace 和 `runner.ts` 开始带学，不要求学习者先修复半成品。实现验收完成不等于学习者已经掌握项目。
