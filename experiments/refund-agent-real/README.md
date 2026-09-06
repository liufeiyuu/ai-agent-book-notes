# 真实模型退款咨询 Agent（TypeScript）

第二周补充实战：复用第一周 Agent Loop，接通 **真实 Embedding → 本地向量检索 → 真实模型回答/工具调用 → 引用与行为检查**。业务数据是虚构的，模型接口不是模拟的。

目标不是做一个可上线客服，而是让你亲自追踪：模型究竟看到什么、工具是谁调用的、证据从哪里来、错误在哪一层发生。

## 当前验证状态

- 已实现全部 CLI 入口、真实接口适配、索引缓存、两种运行模式和分阶段 Trace。
- 2026-09-06：TypeScript 编译通过，20 个离线测试通过；`inspect` 识别出 5 份政策、14 个块。
- 当前未配置 API Key/聊天模型，尚未生成真实向量索引，尚未进行真实模型验收。`ask` 已验证会明确报缺少配置，不降级到假模型。
- 离线测试使用显式测试替身，只验证程序行为，不能证明真实模型会正确检索、调用工具或理解引用。真实运行结果待配置后记录在 `runs/`。

## 范围：哪些真，哪些是本地样例

| 部分 | 实现 |
| --- | --- |
| 政策、订单 | 本地虚构 JSON/Markdown；不接真实电商账户，不执行退款 |
| 分块 | 按 Markdown 小节与完整段落切分；600 字符上限，不是 token 数 |
| 文档与查询向量 | OpenRouter Embedding API；同一模型，真实返回的向量 |
| 检索 | 订单范围过滤后，计算真实向量余弦相似度，选择 Top-K |
| 固定 RAG | 程序确定订单、检索并组装上下文；真实聊天模型生成回答 |
| Agent | 真实模型决定 `query_orders` / `search_policy`；第一周 Harness 执行循环 |
| 检查 | 测试标签只供评测，检查订单、目标证据块、引用原文、状态、工具执行及终止 |

先用真实稠密检索建立基线，没有同时加入 BM25、融合和神经重排。小型索引直接保存在 JSON 中，不需要数据库。耳罩式耳机每个适用版本有 5 个块，默认取 3 个，不是把所有适用内容直接交给模型。

## 配置与启动

环境：Node.js 20.11+。本目录复用第一周的 `typescript`、`tsx`、`@types/node` 依赖和源码，不需要再引入 Agent 框架。如果第一周依赖尚未安装，在仓库根目录运行 `npm ci --prefix experiments/minimal-agent-ts`。

在本目录 `.env` 中填写：

```dotenv
OPENROUTER_API_KEY=你本地保存的密钥
OPENROUTER_MODEL=你账号可用且支持工具调用的模型ID
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
MAX_API_CALLS=24
MAX_OUTPUT_TOKENS=1500
```

可复用第一周 `.env`：加载顺序是第一周文件 → 本目录文件 → shell 环境变量，空值不会覆盖已有配置。不要把密钥发到聊天里。`.env`、`data/`、`runs/` 均被 Git 忽略。占位聊天模型不提供默认值，避免替你选择未授权或不可用的模型。

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
| 5 | `src/tools.ts` + 第一周 `src/agent.ts` | 谁决定搜什么，谁执行，结果如何回到下一轮？ |
| 6 | `src/evaluation.ts` + 一份真实 `runs/*.json` | 怎么区分检索失败、工具失败、生成错误和评测漏洞？ |

## Trace：运行后看什么

每条联网命令输出唯一 Trace 路径。缺失凭据在调用前报错，无真实运行 Trace；请求开始后的网络/解析失败则尽量保存错误与已发请求。不会重试到成功，也不会为通过评测偷偷改变答案。

`data/index.json` 保存块、向量、模型、维度和源内容指纹。正文、元数据或模型改变后，查询拒绝使用旧索引；执行 `npm run index` 重建派生索引。小项目全量重建，未实现生产增量发布/回滚。

回答 Trace 重点：

- `cases[i].requests`：真正发给聊天 API 的 body，包括实际 messages/tools、temperature 和 max_tokens，不包含认证头。
- `cases[i].exchanges`：第一周适配器记录的响应体及 HTTP 状态；其中 request 是注入 token 限制之前的副本，实际 payload 以 `requests` 为准。
- `cases[i].searches`：查询、业务过滤范围、排除原因、完整候选排名、最终 hits 和查询 usage。
- `cases[i].execution`：固定 RAG 的请求/响应，或 Agent 每轮事件及 tool_call_id。
- `cases[i].rawAnswer` / `evaluation`：未经美化的回答和逐项检查。
- `apiCalls` / `embeddingExchanges`：调用数量、Embedding usage 与延迟；聊天 usage 见对应响应体。

同一 Agent 运行中的相同订单/相同检索语句会复用结果；Trace 保留每次工具观察。没有候选时不调用查询 Embedding，也不把空结果解释为允许退款。

调用预算每个 CLI 进程单独计算，默认最多 24 次 Chat+Embedding 请求；Agent 最多 6 轮、150 秒。预算不是金额上限；重跑命令会开启新预算，具体费用以账户账单为准。不要一开始执行大量评测。

仅使用虚构数据。自定义问题和检索原文会发送到外部接口，并可能保存在本地 Trace；不要输入真实个人信息、密钥或订单。Trace 未做通用 PII 脱敏，不应未经检查分享或提交。

## 如何验收，不提前宣判结果

案例：`normal`（明确订单）、`paraphrase`（改写说法）、`historical`（历史适用版本）、`missing`（无适用政策）、`ambiguous`（目标不明）、`exception`（卫生封条例外）。先预测，再运行，再检查。没有承诺某模型全部通过。

自动检查包括：JSON 格式、已查询订单、应检索的关键块是否出现、应引用的文档/块、引用是否为实际上下文中的原文、业务状态是否符合标注、运行是否正常结束。Agent 还检查实际查过订单、必要时确实发起过政策查询。

**引用原文匹配不等于引用支持结论。** 即使全部检查通过，仍需人工核对：是否漏掉条件？把“可以申请”说成“已经退款”？摘取了原文却曲解含义？因此 `requiresHumanReview` 始终为 true。

单次小样本运行不能证明模型稳定可靠或本方案普遍最好。缺引用、答错或工具没调用都是实验结果，要定位原因，不能改金标或测试来“修绿”。自定义问题没有标准答案标签，自动通过的含义更弱。

## 延后内容

BM25/混合检索/神经重排、向量数据库、Embedding 数学推导、自动压缩、长期记忆持久化、生产鉴权、真实退款写操作、服务部署与全量性能优化。先完成一次真实端到端运行和一次有证据的改动。

接口依据：[OpenRouter Embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)、[OpenRouter RAG 示例](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/rag)。聊天协议复用本仓库第一周实现。
