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

## 当前限制

- Harness 会顺序执行同一轮的多个 Tool Call，尚未并发执行；
- 没有任务级 Evaluator，`taskSuccess` 仍未知；
- 没有流式输出；
- 没有上下文压缩与持久会话；
- Trace 写入固定文件名，下一次运行会覆盖上一次；
- 文件工具只适合教学，不应直接视为生产级沙箱。

这些限制是刻意保留的。第一周的目标是理解循环，而不是提前构建复杂框架。

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
