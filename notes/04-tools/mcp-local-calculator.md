# MCP 本地计算器：从直接调用到协议调用

> 2026-09-17 进度纠正：下文 A/B“收尾、通过、完成”是当时助手基于局部反馈作出的判断，不能代表学习者已经读完原有实验与源码。用户已明确源码带读未完成；保留实现和运行事实，撤回整体学习完成判断，实际接续位置见[Stage 3 计划](../stage-03-plan.md#执行进度)。

2026-09-15，Stage 3 B 首轮。助手实现并运行；学习者尚未复现或反馈。没有模型调用。

## 本轮要理解的数据流

直接调用时，调用程序与 calculator 可以在同一个进程里。现在 Client 启动独立的 Server 进程，双方通过 stdio 传输 MCP JSON-RPC 消息；Server 接收请求后仍调用原来的 calculator。

```mermaid
flowchart LR
    A[本轮测试程序] --> B[MCP Client]
    B <-->|stdio：MCP 消息| C[MCP Server]
    C --> D[原有 calculator]
    D --> C
```

在完整 Agent 应用中，应用管理模型对话，并使用 MCP Client 访问 Server；模型根据提供的工具定义生成调用请求，应用负责转交。MCP Client 不是模型，MCP Server 也不负责替模型决定何时调用。Function Calling 描述模型输出工具调用这一侧；MCP 规定应用与工具服务如何交互，两者可以配合。

## 首轮实际实现与结果

- [Server](../../experiments/minimal-agent-ts/src/mcp/calculator-server.ts)：注册 calculator 的描述与参数 Schema；SDK 校验后复用 calculator.parseArguments 和 execute；把结果包装为 MCP content，错误设置 isError。
- [Client](../../experiments/minimal-agent-ts/src/mcp/calculator-client.ts)：启动 Server、初始化、发现和调用，旁路记录实际协议消息，并在 finally 关闭连接。断言同时核对结果和计算器是否实际进入执行。
- [首次基线记录](../../experiments/minimal-agent-ts/artifacts/mcp-calculator-baseline.json)：保留本轮完整收发消息、工具定义、结果与 Server 执行日志。
- [最近一次运行记录](../../experiments/minimal-agent-ts/artifacts/mcp-calculator-latest.json)：每次 demo:mcp 会更新此文件，基线记录保持不变。

实际调用顺序：

| 协议消息 | 本次作用 |
| --- | --- |
| initialize 请求/响应 | 协商协议版本并交换能力；实际协商版本为 2025-11-25，Server 宣告 tools 能力 |
| notifications/initialized | Client 通知初始化完成 |
| tools/list | 返回 calculator 的 name、description、inputSchema |
| tools/call × 3 | 分别提交正常、非法参数与除零案例 |

| 输入 | 实际结果 | 是否进入 calculator.execute |
| --- | --- | --- |
| divide, 6, 3 | content 为 text 块，text 是字符串 "2" | 是 |
| divide, 6, "3" | isError: true，SDK 报 right 应为 number | 否 |
| divide, 6, 0 | isError: true，Cannot divide by zero. | 是 |

本轮成功结果是 `{"content":[{"type":"text","text":"2"}]}`。与已有工具执行器的 `{"ok":true,"output":2,...}` 形状不同，MCP 不会自动替应用转换成仓库内部 ToolResult。

## 首轮运行与验证边界

在 experiments/minimal-agent-ts 目录执行：

```sh
npm run typecheck
npm run demo:mcp
```

两条命令均已由助手运行通过。演示自带断言验证发现结果、正常/失败反馈、握手顺序及非法参数不执行；三个 tools/call 均为真实本地协议调用，原计算器只执行两次。20 秒看门狗限制演示时长，正常结束关闭子进程。

依赖锁定为官方 @modelcontextprotocol/client、server 2.0.0 与 zod 4.6.5，Node 要求 >=20。npm 首次查询遇到沙箱 DNS 限制，经允许的联网执行后安装成功；没有额外模型调用。官方资料已切到 v2 的拆分包，本实验使用对应 API；SDK 包版本与协议协商版本不同。

当前已证明工具可被发现、可被真实调用及错误可回传；没有把结果送入模型请求，也没有证明模型自主选择工具。未接入桌面应用配置、HTTP 服务或远程部署。

## 接续位置

结构化结果和 Loop 适配现已按下节完成。接下来结合第二轮输入讨论：若 Server 已算出结果，但下一轮模型没有收到工具消息，应检查应用中的适配、ToolResult 包装与消息写入哪一段。学习者映射解释已在文末记录，B 已按原标准收尾。

## 官方依据

- [TypeScript SDK v2 Client 入门](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md)：stdio 子进程、connect、listTools、callTool、关闭连接及模型接入位置。
- [MCP 生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)：初始化、能力协商与 initialized 通知。
- [MCP 工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：发现、调用与结果结构。
- [Server 入门](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server)：stdio 的 stdout 专用于协议消息，日志走 stderr。

## 第二轮：结构化结果接回 Agent Loop（2026-09-15）

本轮助手完成代码、运行及验证；没有真实 LLM API 调用。官方规范中的 structuredContent 是 Server 返回的结构化数据，可配合 outputSchema 校验，并在文本块中返回序列化 JSON；它不是模型的结构化生成能力。[规范依据](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content)

### 改了什么

Server 现在声明输出 `{ value: number }`，成功时返回：

```json
{
  "content": [{ "type": "text", "text": "{\"value\":2}" }],
  "structuredContent": { "value": 2 }
}
```

相比基线，文本从 `"2"` 变为序列化对象字符串；程序读取明确的 structuredContent.value，不从自然语言猜数值。文本与结构化内容来自同一个 output 对象。

新增[计算器适配层](../../experiments/minimal-agent-ts/src/mcp/calculator-adapter.ts)，将 tools/list 得到的名称、描述和参数 Schema 注册到原 ToolRegistry。参数复用本地 calculator 校验；execute 改为通过 Client 发出 MCP 请求，先检查 isError，再检查结构化 value 为有限数值，最后返回该数值。原 executeToolCall 将其包装为 ToolResult，原 Loop 写入 tool 消息，两者实现均未改动。

```text
MCP structuredContent.value = 2
    → 适配层返回数字 2
    → executeToolCall 包装 { ok: true, toolCallId, toolName, output: 2 }
    → toolResultToMessage 生成 role: tool 消息
    → runAgent 在下一轮 model.generate 的输入中带上它
```

模型侧调用 ID 沿用 `loop-valid` / `loop-error`；MCP JSON-RPC 请求 ID 由 Client 管理，两种 ID 不混用。MCP isError 会在适配层抛错，再由现有执行器包装为 execution_error；这是一种本课最小映射，未实现所有远端错误码、重试分类或通用多媒体映射。

### 实际验证证据

- `npm run typecheck`：通过。首次检查要求对 SDK 返回的 structuredContent 做运行时类型收窄，助手补齐后通过。
- `node --import tsx --test tests/mcp-calculator-adapter.test.ts`：[3 项测试](../../experiments/minimal-agent-ts/tests/mcp-calculator-adapter.test.ts)通过，覆盖数值 0、错误优先于数值、拒绝缺失/字符串/非有限结果。
- `npm run demo:mcp`：通过。原三组协议案例复验，额外两组通过现有 runAgent 和 MockModel 验证成功及除零链路。
- [首轮基线](../../experiments/minimal-agent-ts/artifacts/mcp-calculator-baseline.json)保持不变；[改后完整记录](../../experiments/minimal-agent-ts/artifacts/mcp-calculator-latest.json)保留 SDK 收发、四次计算器执行、两组 Loop Trace 和 MockModel 实际收到的请求；[Server/Client 修改对照](../../experiments/minimal-agent-ts/artifacts/mcp-structured-result.patch)供后续审查，新增适配层与测试按上方源码链接阅读。

| 路径 | MockModel 第二轮实际收到的 ToolResult | 脚本化最终回答 |
| --- | --- | --- |
| 6 ÷ 3 | ok: true，output: 2，toolCallId: loop-valid | 计算结果：2 |
| 6 ÷ 0 | ok: false，execution_error，Cannot divide by zero.，toolCallId: loop-error | 计算失败：Cannot divide by zero. |

每组 Loop 均有两轮 MockModel.generate。回答由脚本依据实际 tool 消息生成，不是真实模型推理。除零案例的 run.completed 表示循环正常结束并报告失败，不表示计算业务成功。已验证结果进入离线模型接口输入；尚未验证真实模型请求或模型自主选工具。

本轮实际协议调用为 initialize ×1、tools/list ×1、tools/call ×5，另有 initialized 通知；其中四次进入原计算器，字符串参数在 SDK 层被拒绝。本课程累计 initialize ×2、tools/list ×2、tools/call ×8，真实 LLM API 调用仍为 0。

## 学习者反馈与 B 收尾（2026-09-15）

学习者判断：应检查 MCP 结果返回给 Agent，以及 Agent Loop 中信息构造这一段。该回答正确定位了计算完成之后的回传、适配和上下文写入职责，满足 B 原有的映射解释要求。

助手补充检查顺序：Client 是否收到实际响应；适配层是否正确读取成功或错误并交给执行器包装 ToolResult；Loop 是否写入对应 toolCallId 的 tool 消息，并实际携带到下一轮请求。Server 日志只能证明计算在服务端发生，不能替代接收端和模型输入证据。

发现与按需加载的范围补充：tools/list 是让应用知道可用工具；应用可以根据当前任务选择向模型提供哪些工具定义。工具多时筛选相关定义可以减少上下文占用和无关选项，本实验只有一个工具，不建设搜索或动态加载平台。

B 已具备真实发现/调用记录、接入图、助手结果映射修改、成功/失败验证及学习者解释，按既有标准完成。真实 LLM API 调用仍为 0，MockModel 证据只证明离线接口链路。本轮仅反馈与归档，没有新增运行；下一步进入 C 的需求说明、修改、diff 与验证审查，不再追加 MCP 作业。
