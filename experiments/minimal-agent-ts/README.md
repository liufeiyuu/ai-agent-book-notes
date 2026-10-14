# TypeScript 最小 Agent 实验

这个实验不依赖 Agent 框架，目标是亲手看清以下底层机制：

- 结构化 Message 与 Tool Call；
- Tool Definition、参数校验与真实执行的边界；
- Tool Result 如何写回 Context；
- Agent Loop 如何继续或停止；
- `maxTurns`、超时、取消和错误结果；
- OpenRouter API 格式与内部类型之间的 Adapter；
- 完整成功和失败 Trace。

## 架构

```text
调用方（Demo / 测试）
  ↓ runAgent()
Agent Loop / Harness
  ├── Model
  │   ├── MockModel：确定性测试
  │   └── OpenRouterModel：真实云模型 Adapter
  ├── ToolRegistry
  ├── Tool Executor
  ├── calculator
  ├── current_time
  └── read_file
       ↓
Environment（时钟、文件系统等）
```

Model 只提出结构化行动。Harness 负责校验、权限控制和真实执行；Environment 产生实际结果；Harness 再将结果转换为 Tool Message，写回下一轮 Context。

## 运行条件

- Node.js 20+
- npm
- 真实模型演示需要 OpenRouter API Key

安装与检查：

```bash
npm install
npm run typecheck
npm test
```

当前测试覆盖：Agent 成功路径、未知工具、非法参数修正、执行异常、`maxTurns`、超时、用户取消、工具注册表、三个工具和 OpenRouter Adapter。

## 运行演示

### 1. 不访问网络的最小成功路径

```bash
npm run demo
```

`MockModel` 的响应是预先编排的。这个演示验证 Harness 协议，不证明真实模型具有决策或修正能力。

### 2. 不访问网络的失败场景

```bash
npm run demo:failures
```

完整结果写入 [`runs/failure-scenarios.json`](./runs/failure-scenarios.json)。

### 3. 真实 OpenRouter 三工具实验

先提供环境变量。不要把真实 Key 写进源码：

```bash
export OPENROUTER_API_KEY="your-key"
export OPENROUTER_MODEL="deepseek/deepseek-v4-flash"
npm run demo:openrouter
```

也可以复制 `.env.example` 为被 Git 忽略的 `.env`，再自行加载变量。

实验要求模型完成三项任务：

1. 用 `read_file` 读取无敏感 fixture；
2. 用 `current_time` 查询上海时间；
3. 用 `calculator` 完成乘法。

完整结果写入 [`runs/latest-openrouter-run.json`](./runs/latest-openrouter-run.json)。文件包含请求消息和模型原始响应，但不包含 Authorization Header 或 API Key。

> Tool Result 会发送回云模型。不要在未审查数据内容和外发授权时，让 `read_file` 读取真实私有文件。

## 三个工具

### calculator

- Schema 校验 `operation`、`left`、`right`；
- 不使用 `eval`；
- 除以零在执行阶段返回 `execution_error`。

### current_time

- 要求显式传入 IANA 时区；
- 使用真实系统时钟；
- 测试通过注入固定时钟保持确定性。

### read_file

- 只允许工作区相对路径；
- 拒绝绝对路径和 `..`；
- 使用 `realpath` 防止符号链接逃逸；
- 只读取普通 UTF-8 文件；
- 限制最大文件大小。

“拥有文件工具”不等于“拥有整台机器的文件权限”。真正的能力边界由 Harness 决定。

## 成功 Trace 怎么读

不要从头逐字段阅读。按下面顺序寻找事件：

```text
model_request
→ model_response（零个或多个 Tool Call）
→ tool_start
→ tool_end（Tool Result）
→ 下一轮 model_request
→ model_response（最终文本且没有 Tool Call）
→ run_stop(final_response)
```

真实三工具实验的第二轮角色顺序是：

```text
system → user → assistant → tool → tool → tool
```

一个模型响应对应一条 Assistant Message；该消息可以包含多个 Tool Call。每个调用产生一条通过 `toolCallId` 配对的 Tool Message。

## 失败 Trace 怎么读

| 场景 | Tool Result | Loop 结果 | 关键结论 |
| --- | --- | --- | --- |
| 工具不存在 | `tool_not_found` | 模型返回说明后 `completed: true` | Environment 没有执行 |
| 参数非法 | `invalid_arguments` | 模型修改参数后成功 | Harness 不替模型猜参数 |
| 文件不存在 | `execution_error` | 模型返回说明后 `completed: true` | 行动失败不等于协议未完成 |
| 重复调用 | 工具都成功 | `max_turns`、`completed: false` | 行动成功不等于任务完成 |

`completed` 只表示是否获得协议级终态，不表示业务目标一定正确完成。任务正确性需要独立的 `taskSuccess` 评估规则。

## 推荐阅读顺序

1. `src/openrouter-demo.ts`：调用方如何组装 Agent；
2. `src/agent.ts` 第 64～165 行：Agent Loop 主路径；
3. `src/tool-executor.ts`：查找、校验和执行工具；
4. `src/tools/read-file.ts`：工具权限边界；
5. `src/openrouter-model.ts`：供应商协议 Adapter；
6. `runs/*.json`：用真实轨迹验证代码理解。

## Stage 4 A3：草稿审批的最小对照

这是学习计划中的补充实践。新增 [draft-workflow.ts](src/draft-workflow.ts)，复用 Stage 3 的 `create_draft`、注册表和执行器；审批检查放在调用执行器之前。原有直接调用工具的 Stage 3 演示仍保留，审批只由新工作流入口执行。

```bash
npm run demo:approval
```

[演示入口](src/draft-approval-demo.ts)对同一正文“项目周报：异步任务实验已完成。”展示三种行为：

| 输入/动作 | 工作流状态 | 内存草稿数 |
| --- | --- | --- |
| 提议后尝试执行，尚未批准 | waiting_approval | 0 |
| 用户批准 | approved | 0 |
| 批准后执行 | succeeded | 1 |
| 用户拒绝后尝试执行（独立集合） | rejected | 0 |

调用关系：`propose → 保存待审批的动作和正文 → decideFromUser → execute 的 approved 检查 → executeToolCall → 原草稿工具保存`。未批准会保存状态并返回，应用之后可提交审批；拒绝是本次请求的终态。批准对应保存的请求编号和正文，执行时不能附带另一份正文。

本演示由测试驱动模拟用户的批准/拒绝，不调用真实模型或 MockModel。`decideFromUser` 是应用侧入口，不注册为模型工具；模型参数只允许 `content`，自填 `approved: true` 会被原工具校验拒绝。返回对象为副本，修改它不会更改内部审批或待执行正文。本地函数分工不等于生产系统的身份认证；此处没有实现 Web 审批、数据库、跨进程恢复或通用权限平台。

本次关键判断变化为：Stage 3 中合法正文可直接保存；新工作流只有明确 `approved` 才调用保存工具。演示保留原行为对照和修改后的轨迹，检查未批准无写入、批准后原样保存、拒绝无写入及伪造批准字段被拒绝。每次运行写入新的 `runs/approval-<UTC时间戳>/result.json`，不会覆盖已有结果。[首次助手运行记录](runs/approval-2026-10-13T01-46-46-711Z/result.json)的 6 项检查通过。

相关验证命令（无需安装新依赖）：

```bash
npm run typecheck
node --import tsx --test tests/draft-workflow.test.ts tests/create-draft.test.ts tests/tool-executor.test.ts
```

首次类型检查与 12 项相关测试通过，其中新增审批测试 4 项。重复提交的后续实现见下节；有界重试与草稿写入前取消对照仍待接续。A2 子进程取消证据直接引用；学习状态、实际调用与下一步统一维护在 [Stage 4 执行进度](../../notes/stage-04-plan.md#执行进度)。

### 同键重复提交与参数冲突

在同一个 `draft-workflow.ts` 中，`propose({ content }, "save-001")` 可带应用侧的提交键。调用方在首次提交前确定键，并在重发同一次操作时复用；它与程序生成的审批请求编号 `A1`、保存后生成的 `draftId` 分工不同。原审批演示不传键时仍每次创建新请求。

```bash
npm run demo:idempotency
```

[演示入口](src/draft-idempotency-demo.ts)固定同一正文和键，真实执行内存保存，由驱动模拟用户批准，不调用模型。[首次助手运行记录](runs/idempotency-2026-10-14T01-21-31-092Z/result.json)的 6 项检查通过：

| 操作 | 结果 | 草稿数 |
| --- | --- | --- |
| 首次提议 save-001 | 创建 A1，waiting_approval | 0 |
| 未批准时同键同正文重发 | 返回原 A1，仍 waiting_approval | 0 |
| 批准 A1 并执行 | succeeded，保存 toolResult 与草稿 ID | 1 |
| 成功后同键同正文重发 | 返回原 A1 和同一 toolResult | 1 |
| 对返回的 A1 再调用 execute | 返回原成功结果，不再保存 | 1 |
| 同键换正文 | idempotency_conflict，原请求与正文保留 | 1 |

关键路径：`propose → requestIdByKey 查键 → requests 取原请求 → 比较 content → 相同则返回副本 / 不同则抛冲突`；未找到键才创建请求并登记映射。登记发生在提议阶段，待审批的重发也不会另建请求。执行时复用原 `status !== "approved"` 判断，成功请求携带已有结果直接返回，避免第二次调用保存工具。

本例只有固定动作 `create_draft` 和一个 `content` 参数，直接比较完整字符串，空白也算正文差异。同键同参数返回的是原请求**当前状态**：未获批仍等待，运行中仍为 running，拒绝后仍为 rejected；只有完成后才有最终结果。冲突在工作流入口抛出，由演示调用方捕获记录，不是原保存工具产生的 ToolResult 错误，也不会把原成功请求改成 failed。

不同键代表不同操作，即使正文相同，也会新建请求并各自审批；幂等键不承担按内容去重或身份认证。映射仅在一个工作流实例的内存中有效，本轮未实现数据库约束、跨实例/跨进程去重、重启恢复或失败自动重试。新增 4 项测试覆盖状态与结果复用、冲突保留原记录（含空白差异）、不同键独立审批、拒绝后不能靠同键重发重新开启请求；类型检查与 16 项相关测试通过。每次演示写入独立的 `runs/idempotency-<UTC时间戳>/result.json`。

## 当前限制

- Harness 会顺序执行同一轮的多个 Tool Call，尚未并发执行；
- 没有任务级 Evaluator，`taskSuccess` 仍未知；
- 没有流式输出；
- 没有上下文压缩与持久会话；
- Trace 写入固定文件名，下一次运行会覆盖上一次；
- 文件工具只适合教学，不应直接视为生产级沙箱。

这些限制是刻意保留的。Stage 1 的目标是理解循环，而不是提前构建复杂框架。

## 五分钟讲解提纲

不要背代码，按以下顺序脱稿说明：

1. Model、Harness、Environment 分别负责什么；
2. 一轮模型请求包含哪些 Context 和 Tool Definitions；
3. Tool Call 为什么不是普通字符串；
4. Harness 如何查找、校验和执行工具；
5. Tool Result 为什么必须带 `toolCallId` 写回 Context；
6. 正常回答、`maxTurns`、超时、取消和模型错误如何停止；
7. 为什么 `completed` 不等于 `taskSuccess`；
8. `read_file` 为什么必须限制权限和数据外发。
