# 真实模型退款咨询 Agent（TypeScript）

Stage 2 补充实战：复用 Stage 1 Agent Loop，接通 **真实 Embedding → 本地向量检索 → 真实模型回答/工具调用 → 引用与行为检查**。业务数据是虚构的，模型接口不是模拟的。

目标不是做一个可上线客服，而是让你亲自追踪：模型究竟看到什么、工具是谁调用的、证据从哪里来、错误在哪一层发生。

## 当前验证状态

- 已实现全部 CLI 入口、真实接口适配、索引缓存、两种运行模式和分阶段 Trace。
- 2026-09-13：TypeScript 检查通过；退款项目离线测试 **42/42**、共用 Stage 1 组件测试 **39/39** 通过。业务数据仍为 5 份政策、14 个块。
- 当前模型：`qwen/qwen3-embedding-8b` + `deepseek/deepseek-v4-flash-0731`。14 个块的 4096 维真实索引、查询向量化、聊天及 Agent 工具调用均已运行；先前 OpenAI/Gemini 的 403 记录保留在[真实运行记录](./LIVE-RUN.md)。
- DeepSeek V4 使用非思考模式（`reasoning.enabled=false`），适配本项目小输出预算和未实现 reasoning 回传的 Stage 1 协议。首次未显式关闭思考时，输出因 `length` 截断且无最终答案；该失败也已归档。
- 历史验收（2026-09-06）：当时 30 个离线测试通过，真实固定 RAG **6/6**、Agent **6/6**，分别使用 10/40、31/40 次请求；固定 RAG 两轮均 6/6。这些是当时的样本结果，不代表以后每次运行都通过。
- 历史修复包括补齐 Qwen 查询指令；没有扩大 Top-K、塞入全部政策或修改金标。9 月 6 日的 Agent 六例均使用了一次格式恢复。原始失败及完整 Trace 保留在[真实运行记录](./LIVE-RUN.md)。
- 2026-09-13 复测发现 Agent 可能在调用任何工具前直接结束。现已增加程序层面的流程检查：成功查单、成功搜索目标订单政策后才接受最终回答；提前结束会被拒绝，并受原有轮数与时间上限约束。
- 修复后真实复测：Agent **6/6**，21/40 次请求；固定 RAG **6/6**，10/40 次请求，均已逐例核对且未触发格式恢复。Agent 本轮没有重复工具调用，也没有触发 `final_rejected`；拒绝分支由离线原故障回放覆盖。`missing` 两次运行（单例与套件）均实际查询 B1003、成功取得空政策结果，再返回 `insufficient_evidence`，仅说明缺少政策；单例使用 3 次聊天请求。具体 Trace、核对结果及限制见[真实运行记录](./LIVE-RUN.md)。
- 学习者的代码理解与实践尚未完成；本次修复不重置已有学习进度。小样本通过不代表生产可靠性，所有回答仍需人工核对。

## 范围：哪些真，哪些是本地样例

| 部分 | 实现 |
| --- | --- |
| 政策、订单 | 本地虚构 JSON/Markdown；不接真实电商账户，不执行退款 |
| 分块 | 按 Markdown 小节与完整段落切分；600 字符上限，不是 token 数 |
| 文档与查询向量 | OpenRouter Embedding API；同一模型，真实返回的向量 |
| 检索 | 订单范围过滤后，计算真实向量余弦相似度，选择 Top-K |
| 固定 RAG | 程序确定订单、检索并组装上下文；真实聊天模型生成回答 |
| Agent | 程序约束必需的查单/检索阶段；真实模型生成工具调用和查询内容，Stage 1 Harness 执行循环 |
| 检查 | 测试标签只供评测，检查订单、目标证据块、引用原文、状态、工具执行及终止 |

先用真实稠密检索建立基线，没有同时加入 BM25、融合和神经重排。小型索引直接保存在 JSON 中，不需要数据库。耳罩式耳机每个适用版本有 5 个块，默认取 3 个，不是把所有适用内容直接交给模型。

## 配置与启动

环境：Node.js 20.11+。本目录复用 Stage 1 的 `typescript`、`tsx`、`@types/node` 依赖和源码，不需要再引入 Agent 框架。如果 Stage 1 依赖尚未安装，在仓库根目录运行 `npm ci --prefix experiments/minimal-agent-ts`。

在本目录 `.env` 中填写：

```dotenv
OPENROUTER_API_KEY=你本地保存的密钥
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
OPENROUTER_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
MAX_API_CALLS=40
MAX_OUTPUT_TOKENS=1500
```

当前默认 Embedding 已改为 [Qwen3 Embedding 8B](https://openrouter.ai/qwen/qwen3-embedding-8b)。文档和查询使用同一模型；更换模型后必须重新建索引，不能混用旧向量。模型列在平台目录中不保证当前账户或地区可访问，需以实际调用为准。

可复用 Stage 1 `.env`：加载顺序是 Stage 1 文件 → 本目录文件 → shell 环境变量，空值不会覆盖已有配置。不要把密钥发到聊天里。`.env`、`data/`、`runs/` 均被 Git 忽略。配置示例按用户要求选用 DeepSeek V4 Flash 0731；代码仍要求显式配置聊天模型，不提供隐式回退。

聊天模型和 Embedding 模型不要求同一厂商。当前 DeepSeek 官方模型目录与 OpenRouter Embedding 列表未提供 DeepSeek Embedding 模型，不能把 V4 聊天模型 ID 填进 Embedding 配置；因此保留 Qwen 向量模型。核对来源：[DeepSeek 模型目录](https://api-docs.deepseek.com/quick_start/pricing/)、[OpenRouter Embedding 列表](https://openrouter.ai/api/v1/embeddings/models)、[V4 Flash 0731](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)。

```bash
cd /Users/taikongren/Desktop/workspace/ai-agent-book-notes/experiments/refund-agent-real
npm run typecheck
npm test
npm run inspect
```

以上三条不联网。下面开始调用付费接口，**先一条一条执行**：

```bash
# 首次把 14 个文档块批量向量化并保存；缓存有效时不重复调用。
npm run index

# 先只检查证据，不让聊天模型回答。
npm run retrieve -- --query "耳机外包装拆了，配件齐全，能退吗？" --order H1001

# 同一道明确订单问题，先跑固定 RAG，再跑 Agent。
npm run ask -- --case normal --mode rag
npm run ask -- --case normal --mode agent
```

单例看懂后再验收：

```bash
npm run ask -- --case historical --mode agent
npm run ask -- --case ambiguous --mode agent
npm run ask -- --case missing --mode agent
npm run evaluate -- --mode agent --limit 6
```

自定义问题：

```bash
npm run ask -- --mode agent --question "H1002 签收十二天了，还能退吗？"
npm run ask -- --mode rag --order H1002 --question "签收十二天了，还能退吗？"
```

固定 RAG 不负责从自然语言抽取订单，需 `--order`；内置案例用预先给定的订单 ID。Agent 可以自行查询，也可以接受显式选定的 ID。`--case` 不能和 `--question`/`--order` 混用。

Agent 没有 `--order` 时，流程检查采用首个非空查询返回的候选集：多个候选不能因为模型后来任意精查一单就变成“用户已确认”。但第一次查找仍依赖模型正确理解问题；如果它一开始就猜了某个订单，程序尚不能识别所有这类语言歧义。已确认目标时，显式提供 `--order` 能建立更明确的检查边界。

CLI 每次启动一个新会话。若模型请你澄清，下一条命令显式提供订单 ID 和完整问题；目前没有跨命令对话历史持久化。此项目也未实现长期记忆读写或自动上下文压缩。

## 固定业务时钟与版本

业务“今天”固定为 **2026-09-06**，避免下个月再跑时所有订单都超过期限。日志的运行时间仍是真实时间。

这里特意规定：按**购买日期**选政策，按**签收后经过的自然日**判断期限；这是虚构商城约定，不是所有业务的通用规则。生效区间为 `[effectiveFrom, effectiveUntil)`。

订单查询限定服务端绑定的 `demo-user`，工具参数不能覆盖用户身份。模型也不能伪造政策日期或品类过滤：这些由已查询订单产生。这是本地权限边界示范，不是生产登录认证。

## 学习入口

不要从 CLI 开始通读。先读 [分步学习指南](./STUDY.md)，每次只完成一站。

| 顺序 | 代码入口 | 要掌握的问题 |
| --- | --- | --- |
| 1 | `src/runner.ts` 的 `runConsultation`，仅 `rag` 分支 | 订单、检索结果、messages 是如何接起来的？ |
| 2 | `src/corpus.ts` → `src/provider.ts` → `src/index-store.ts` | 原文如何变成可回溯的真实向量索引？ |
| 3 | `src/retrieval.ts` 的 `retrieve` | 业务过滤、语义排序、Top-K 各负责什么？ |
| 4 | `src/context.ts` 的 `buildContext` | 最终模型看到的是原文还是向量？规则和证据如何分开？ |
| 5 | `src/tools.ts` + Stage 1 `src/agent.ts`，再看 `src/workflow.ts` | 谁决定搜什么，谁执行，结果如何回到下一轮；谁检查能否结束？ |
| 6 | `src/evaluation.ts` + 一份真实 `runs/*.json` | 怎么区分检索失败、工具失败、生成错误和评测漏洞？ |

## Trace：运行后看什么

每条联网命令输出唯一 Trace 路径。缺失凭据在调用前报错，无真实运行 Trace；请求开始后的网络/解析失败则尽量保存错误与已发请求。不会无限重试，也不会为通过评测偷偷改变答案或截取末尾 JSON。

Qwen 查询按官方要求使用 `Instruct: …\nQuery:…`，文档不加这个前缀；Trace 同时保留原始 `query` 和实际 `embeddingQuery`。文档索引、业务过滤和 Top-3 不变。

Agent 的 `workflow.ts` 根据工具**成功返回的结果**检查进度，而不是根据模型说“查过了”或答案里的订单号判断。订单未查到前只提供 `query_orders`；已确认一单但尚未成功检索该订单政策时只提供 `search_policy`，并限定该订单 ID。这两个必需阶段使用 `tool_choice: "required"`，不附最终答案的 JSON Schema，避免把工具调用阶段当作回答阶段。工具报错不计成功；成功检索但 `hits: []` 计为完成政策查询。确实查无可访问订单或查到多个候选时，可以进入说明缺口/澄清分支。

具备订单与政策查询结果后，工具选择恢复 `auto`，允许模型在需要时补查，并恢复严格的最终答案 JSON Schema；澄清阶段同样使用 `auto` 与答案 Schema。供应商参数支持和本地严格解析仍保留。如果模型提前给出最终文本，程序记录 `final_rejected`、加入流程缺口说明，在**原有 6 轮、150 秒上限内**继续；不是另开一套重试预算。达到上限或发生失败时，不进入格式恢复。

实测 DeepSeek 在带工具的请求中仍可能夹带解释。因此，仅在流程检查允许结束、且最终文本格式不合规时，追加**最多一次无工具重生成**，输入仅为本次已观察的订单与证据，不包含评测标签。恢复后再次检查流程及目标订单，不能借此跳过工具或换成其他订单。原始失败稿保留在 `formatRecovery.initialAnswer`；第二次仍失败则整例失败。它不是退款操作，也不保证任意模型都能恢复。

`data/index.json` 保存块、向量、模型、维度和源内容指纹。正文、元数据或模型改变后，查询拒绝使用旧索引；执行 `npm run index` 重建派生索引。小项目全量重建，未实现生产增量发布/回滚。

回答 Trace 重点：

- `cases[i].requests`：真正发给聊天 API 的 body，包括实际 messages/tools、`tool_choice`、该阶段是否带 JSON Schema、reasoning、temperature 和 max_tokens，不包含认证头。
- `cases[i].exchanges`：Stage 1 适配器记录的响应体及 HTTP 状态；其中 request 是注入 token 限制之前的副本，实际 payload 以 `requests` 为准。
- `cases[i].searches`：原始/向量化查询、业务过滤范围、排除原因、完整候选排名、最终 hits 和查询 usage。
- `cases[i].execution`：固定 RAG 的请求/响应，或 Agent 每轮事件及 tool_call_id；`final_rejected` 记录哪些最终回答因流程/目标检查未通过而被拒绝。
- `cases[i].workflow`：Agent 的阶段、目标订单、候选 ID、成功查单的 `orderQueries`（含 `returnedOrderIds`）、成功检索的 `policyOrderIds` 和最终检查错误；RAG 为 null。它记录流程依据，不是语义正确性的保证。
- `cases[i].rawAnswer` / `evaluation`：未经美化的回答和逐项检查。
- `cases[i].formatRecovery`：若触发格式恢复，记录原始失败稿、无工具请求和响应；否则为 null。`execution` 保留恢复前的原始执行轨迹。
- `apiCalls` / `embeddingExchanges`：调用数量、Embedding usage 与延迟；聊天 usage 见对应响应体。

同一 Agent 运行中的相同订单/相同检索语句会复用结果；Trace 保留每次工具观察。没有候选时不调用查询 Embedding，也不把空结果解释为允许退款。

调用预算每个 CLI 进程单独计算，默认最多 40 次 Chat+Embedding 请求，整套案例共享；Agent 工具循环最多 6 轮、150 秒，格式恢复最多额外 1 次、60 秒。预算耗尽会明确失败；这是本地保护，不是账户余额耗尽。预算不是金额上限；重跑命令会开启新预算，具体费用以账户账单为准。不要一开始执行大量评测。

仅使用虚构数据。自定义问题和检索原文会发送到外部接口，并可能保存在本地 Trace；不要输入真实个人信息、密钥或订单。Trace 未做通用 PII 脱敏，不应未经检查分享或提交。

## 如何验收，不提前宣判结果

案例：`normal`（明确订单）、`paraphrase`（改写说法）、`historical`（历史适用版本）、`missing`（无适用政策）、`ambiguous`（目标不明）、`exception`（卫生封条例外）。先预测，再运行，再检查。没有承诺某模型全部通过。

自动检查包括：JSON 格式、已查询订单、应检索的关键块是否出现、应引用的文档/块、引用是否为实际上下文中的原文、业务状态是否符合标注、运行是否正常结束。Agent 还检查成功查过订单、`workflow_complete`，以及存在已确认目标时是否成功搜索过**该订单**的政策；仅仅调用过别的订单的搜索不算完成。

**引用原文匹配不等于引用支持结论。** 即使全部检查通过，仍需人工核对：是否漏掉条件？把“可以申请”说成“已经退款”？摘取了原文却曲解含义？因此 `requiresHumanReview` 始终为 true。

单次小样本运行不能证明模型稳定可靠或本方案普遍最好。缺引用、答错或工具没调用都是实验结果，要定位原因，不能改金标或测试来“修绿”。自定义问题没有标准答案标签，自动通过的含义更弱。

## 延后内容

BM25/混合检索/神经重排、向量数据库、Embedding 数学推导、自动压缩、长期记忆持久化、生产鉴权、真实退款写操作、服务部署与全量性能优化。先完成一次真实端到端运行和一次有证据的改动。

接口依据：[OpenRouter Embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)、[OpenRouter RAG 示例](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/rag)。聊天协议复用本仓库 Stage 1 实现。
