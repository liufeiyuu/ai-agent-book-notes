# MCP 本地计算器：从直接调用到协议调用

2026-09-15，第三周 B 首轮。助手实现并运行；学习者尚未复现或反馈。没有模型调用。

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

## 实际实现与结果

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

## 运行与验证边界

在 experiments/minimal-agent-ts 目录执行：

```sh
npm run typecheck
npm run demo:mcp
```

两条命令均已由助手运行通过。演示自带断言验证发现结果、正常/失败反馈、握手顺序及非法参数不执行；三个 tools/call 均为真实本地协议调用，原计算器只执行两次。20 秒看门狗限制演示时长，正常结束关闭子进程。

依赖锁定为官方 @modelcontextprotocol/client、server 2.0.0 与 zod 4.6.5，Node 要求 >=20。npm 首次查询遇到沙箱 DNS 限制，经允许的联网执行后安装成功；没有额外模型调用。官方资料已切到 v2 的拆分包，本实验使用对应 API；SDK 包版本与协议协商版本不同。

当前已证明工具可被发现、可被真实调用及错误可回传；没有把结果送入模型请求，也没有证明模型自主选择工具。未接入桌面应用配置、HTTP 服务或远程部署。

## 接续位置

先由学习者观察 Client → Server → calculator 的职责和两种错误发生位置，再讨论结果映射：本轮只返回 text 块，下一步为成功结果增加结构化数值并明确怎样接回已有 ToolResult。修改由助手完成，保留基线与修改后结果；B 的映射解释与验收仍待完成，不因助手接通就标记整个 B 通过。

## 官方依据

- [TypeScript SDK v2 Client 入门](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-client.md)：stdio 子进程、connect、listTools、callTool、关闭连接及模型接入位置。
- [MCP 生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)：初始化、能力协商与 initialized 通知。
- [MCP 工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：发现、调用与结果结构。
- [Server 入门](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server)：stdio 的 stdout 专用于协议消息，日志走 stderr。
