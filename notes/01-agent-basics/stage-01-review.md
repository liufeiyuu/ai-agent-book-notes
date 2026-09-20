# Stage 1 复盘：Agent 基础与最小实现

> 学习记录覆盖：2026-08-17 ～ 2026-08-23
>
> 阶段验收：2026-08-22
>
> 实现语言：TypeScript

## 本阶段结论

Stage 1 目标验收通过。

本阶段不是只阅读 Agent 概念，而是完成了“理解 → 实验 → 实现 → 真实模型运行 → 失败分析 → 口头讲解”的闭环。当前已经能够结合代码和 Trace 说明 Model、Harness、Environment 的职责，解释 Tool Call 与 Tool Result 如何推动 Agent Loop，并识别协议完成与任务正确完成的区别。

## 完成成果

- [x] 一份 Agent 基础知识地图；
- [x] 一个不依赖 Agent 框架的 TypeScript 最小 Agent；
- [x] 三个工具：`calculator`、`current_time`、`read_file`；
- [x] MockModel 与真实 OpenRouter Model Adapter；
- [x] 一份真实三工具成功 Trace；
- [x] 不存在工具、非法参数、执行失败和 `maxTurns` 四类失败 Trace；
- [x] 参数校验、超时、取消、模型异常和工具错误处理；
- [x] 31 个自动化测试；
- [x] 实验 README 与运行说明；
- [x] 一次约 6 分 52 秒的脱稿讲解；
- [x] Git commit。

相关证据：

- [TypeScript 最小 Agent 实验](../../experiments/minimal-agent-ts/README.md)
- [真实三工具成功 Trace](../../experiments/minimal-agent-ts/runs/latest-openrouter-run.json)
- [四类失败 Trace](../../experiments/minimal-agent-ts/runs/failure-scenarios.json)
- [Day 1 学习记录](./day-01.md)

## 口头讲解转写

以下内容根据六张微信语音转文字截图整理。只修正了标点、重复词和识别错误的英文术语，例如将“哈尼斯”“to call”“to cos”分别还原为 `Harness`、`Tool Call`、`toolCalls`；原截图包含姓名和头像等个人信息，因此不放入仓库。

> 第一次运行时，Agent 会构造第一次请求。`messages` 里面包含 System Prompt 和 User Input；与 `messages` 并列的还有 `tools`。工具定义里包含工具的 `name`、`description` 和参数信息，然后这些内容会发送给 Model。
>
> Model 会处理收到的请求，分析需要调用什么工具，然后向 Agent 返回 Tool Call，说明要调用什么工具以及工具的入参。Agent 根据 Tool Call 去调用工具。
>
> Agent 会先把 Model 返回的 Assistant Message push 到 `messages` 后面，再把工具调用得到的结果也 push 到消息数组。下一轮再次请求 Model 时，会把这些历史信息一起传给 Model。
>
> 循环有五种停止情况：达到 `maxTurns`、用户取消、模型异常、超时，以及正常返回。正常返回时，Model 判断不需要继续调用工具，返回 `content`，同时 `toolCalls` 为空；如果不是因为长度限制被截断，Agent Loop 就会结束，Harness 向调用方返回 Final Answer。
>
> 如果工具调用失败，Harness 会把失败信息结构化成 Tool Result，push 到 `messages` 后面。Model 下一轮读取到失败结果后，可以修正参数重试、选择其他工具，或者说明无法继续。
>
> Model 的职责是进行语言处理和决策，选择调用哪些工具。Harness 相当于 Agent Loop：它不断组合 System、User、Assistant 和 Tool 信息，再传给 Model。因为单次 Model 请求本身没有上一轮记忆，所以 Harness 必须把之前的信息放进 `messages`。
>
> Harness 还负责工具失败校验和循环停止条件。Environment 是文件、时间等真实环境状态。Harness 调度 Tool 去读取或改变 Environment，再把可观察结果转换成消息传给 Model。Environment 本身不负责决策。

## 口头讲解验收

综合评分：

| 维度 | 结果 |
| --- | --- |
| 技术准确性 | 8.5 / 10 |
| 内容完整性 | 9 / 10 |
| 代码与 Trace 对应能力 | 9 / 10 |
| 表达清晰度 | 8 / 10 |

讲解已经覆盖：

- 第一轮 Context 的构造；
- Tool Definitions 与 `messages` 的位置；
- Model 提出 Tool Call、Harness 执行工具；
- Assistant Message 与 Tool Result 写回历史；
- 下一轮重新携带动态轨迹；
- 五类停止原因；
- 工具失败后的反馈与修正；
- Model、Harness、Environment 的边界。

## 需要保留的技术纠正

### 1. Tool Definition 与 Tool Call 参数

原讲解将 Tool Definition 表述为包含实际 `arguments`。更准确的区分是：

```text
Tool Definition = name + description + inputSchema
Tool Call       = id + name + arguments
```

Tool Definition 的 Schema 告诉 Model 应生成什么格式的参数；真正的 `arguments` 由 Model 在本次 Tool Call 中产生。

### 2. Assistant Message 与 Tool Message

两者必须是可关联但独立的消息：

```text
assistant.toolCalls[] = id + name + arguments
tool                  = toolCallId + result/error
```

Harness 必须先保留 Model 提出的结构化行动，再写入 Environment 返回的观察结果。多个 Tool Call 不能只依赖消息顺序，而要通过 `toolCallId` 配对。

### 3. Environment 的职责

Environment 不负责决策，但不等于“什么都不做”。Tool 会在 Harness 调度下读取或改变 Environment，例如读取文件、查询时钟或写入数据库。Harness 只把当前行动产生的必要观察转换成 Tool Result，不会把整个 Environment 放进 Context。

### 4. `completed` 与 `taskSuccess`

当前实现中，Model 返回未被截断的最终文本且没有 Tool Call 时，Harness 会以 `final_response` 停止并返回 `completed: true`。这只是协议级终态，不证明答案正确。业务目标是否真的完成，需要独立 Evaluator、确定性校验或用户确认。

## 本阶段形成的最小心智模型

```text
调用方提交任务
  ↓
Harness 构造 messages + Tool Definitions
  ↓
Model 返回 Final Text 或 Tool Call
  ├── Final Text → Harness 按协议停止
  └── Tool Call
        ↓
      Harness 查找工具、校验参数与权限
        ↓
      Tool 读取或改变 Environment
        ↓
      Harness 写回 Tool Result
        ↓
      进入下一轮 Model 请求
```

异常边界：

```text
工具不存在 / 非法参数 / 执行失败
→ 通常生成失败 Tool Result，让 Model 下一轮调整

maxTurns / timeout / cancelled / model_error
→ Harness 停止整个 Agent Run
```

## 已知限制

当前实现仍是教学级最小 Agent：

- 同一轮多个 Tool Call 由 Harness 顺序执行，没有并发调度；
- 没有任务级 Evaluator；
- 没有流式输出；
- 没有上下文压缩和持久会话；
- Trace 使用固定文件名，重复运行会覆盖；
- `read_file` 有基础路径与大小限制，但不能直接视为生产级文件沙箱。

这些限制是刻意保留的。Stage 1 的目标是掌握 Agent 应用工程的底层循环，而不是提前引入复杂框架。

## 下阶段入口

后续学习继续沿用“先观察 Trace，再修改代码，最后构造失败”的方式。进入下一主题前，应当能够不看代码讲清：

1. Model 为什么不能直接执行副作用；
2. Tool Call 为什么不能当作普通字符串；
3. Tool Result 为什么必须写回 Context；
4. Harness 为什么同时需要权限边界和停止条件；
5. 为什么 `completed` 不等于 `taskSuccess`。
