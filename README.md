# AI Agents in Depth 学习笔记

这是我阅读李博杰老师开源书籍 [《AI Agents in Depth》](https://bojieli.github.io/ai-agent-book/book/introduction/) 时整理的个人学习笔记与实验记录。

## 学习目标

- 用自己的语言复述关键概念，而不只是摘抄原文
- 完成书中的实验和思考题
- 记录实践中的问题、判断与结论
- 建立一套可以持续迭代的 Agent 工程知识库

## 最高优先级原则：抓大放小

时间有限时，优先掌握核心概念、组件边界、完整数据流、关键取舍、失败诊断、最小实现与评测方法。数学推导、框架细节、生产优化和前沿扩展不阻塞当前主线时，记录到[延后学习清单](notes/learning-backlog.md)，等项目出现真实需求再深入。

学习顺序统一为：

```text
搭建框架 → 理解重点 → 最小实践 → 验证结果 → 项目按需深入
```

## 当前学习计划

**当前计划：[第三周：第 4–5 章工具与 Coding Agent](notes/week-03-plan.md)**

本节是当前计划的唯一定位入口。每次带学按[协作指引](AGENTS.md)完整读取上方计划正文及其“执行进度”；详细状态、完成证据和下一步只在该计划内维护。

阶段切换时，写回原计划进度并更新本节的当前计划链接。各阶段的学习顺序、后续计划和 Python/后端接续见[Agent 全栈能力路线](notes/agent-fullstack-roadmap.md)，不在其他文件重复维护当前阶段。

## 阅读进度

| 章节 | 主题 | 状态 | 笔记 |
| --- | --- | --- | --- |
| 0 | 引言 | 已完成 | [进入笔记](notes/00-introduction/README.md) |
| 1 | Agent 基础知识 | 已完成 | [进入笔记](notes/01-agent-basics/README.md) |
| 2 | 上下文工程 | 已完成 | [进入笔记](notes/02-context-engineering/README.md) |
| 3 | 用户记忆和知识库 | 已完成 | [进入笔记](notes/03-memory-and-knowledge/README.md) |
| 4 | 工具 | 已完成 | [进入笔记](notes/04-tools/README.md) |
| 5 | Coding Agent 与代码生成 | 待读 | [进入笔记](notes/05-coding-agent/README.md) |
| 6 | Agent 的评估 | 待读 | [进入笔记](notes/06-evaluation/README.md) |
| 7 | 模型后训练 | 待读 | [进入笔记](notes/07-post-training/README.md) |
| 8 | Agent 的持续进化 | 待读 | [进入笔记](notes/08-continuous-evolution/README.md) |
| 9 | 多模态与实时交互 | 待读 | [进入笔记](notes/09-multimodal-interaction/README.md) |
| 10 | 多 Agent 协作 | 待读 | [进入笔记](notes/10-multi-agent/README.md) |

第四章的“已完成”仅指原文阅读；原有实验与代码带读尚未完成，当前继续第四章代码学习，第五章暂停。具体缺口与代码停点见[当前计划的执行进度](notes/week-03-plan.md#执行进度)。

状态统一使用：`待读`、`阅读中`、`已完成`、`需复习`。

第 2、3 章的“已完成”指第二周选定的知识主干、教学实验、真实模型带学实践与场景验收，已于 2026-09-13 收尾，不代表全章细节和生产实现均已完成。业务 Prompt 独立实践等补验及延后事项见[第二周复盘](notes/week-02-review.md)与[延后学习清单](notes/learning-backlog.md)，不阻塞进入第三周。

阶段计划按当前原书编号分组，上方章节目录保留历史编号；各阶段内容和依赖见[全栈能力路线](notes/agent-fullstack-roadmap.md)。章节阅读状态不代替当前计划的执行进度。

## 阶段复盘

- [第一周：Agent 基础与最小实现](notes/01-agent-basics/week-01-review.md)
- [第二周：上下文、用户记忆与 RAG](notes/week-02-review.md)

## 仓库结构

```text
.
├── README.md
├── notes/                 # 按章节组织的学习笔记
├── experiments/           # 实验代码与运行记录
├── assets/                # 图片等静态资源
└── templates/             # 可复制的笔记模板
```

## 记录约定

1. 本代码仓库的 Markdown 是学习计划、笔记、进度和接续上下文的唯一维护版本。
2. 一篇笔记只解决一个主题，文件名使用小写英文和连字符。
3. 摘抄与个人理解分开记录，引用原文时附上来源链接。
4. 实验不仅记录代码，也记录假设、结果、失败和结论。
5. 自 2026-09-14 起停止维护 Notion 同步副本；已有页面和链接仅作历史参考，当前安排以仓库为准。
6. 非核心细节最多探索 10–15 分钟；不阻塞主线时写入延后学习清单。
7. 每次开始或继续带学前，按[协作指引](AGENTS.md)从本页[当前学习计划](#当前学习计划)定位，完整阅读所指计划正文与“执行进度”，核对范围、实现深度和结束标准；同一会话继续带学也执行。阶段结束或暂停时写回证据、缺口和唯一下一步。

## 资料

- [在线阅读](https://bojieli.github.io/ai-agent-book/book/introduction/)
- [原书 GitHub 仓库](https://github.com/bojieli/ai-agent-book)
