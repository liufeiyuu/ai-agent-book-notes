---
title: 引言
chapter: 0
section: 引言
type: chapter
status: reading
source: https://bojieli.github.io/ai-agent-book/book/introduction/
updated: 2026-07-28
---

# 引言

## 一句话理解

Agent 的关键不是追逐不断变化的新名词，而是理解能够跨越模型迭代周期的架构原则，并通过真实反馈和评估持续改进。

## 阅读前的问题

- Agent 与固定工作流的本质区别是什么？
- `LLM + 上下文 + 工具` 如何映射到实际系统？
- 为什么评估是 Agent 持续进化的基础？

## 核心公式

```text
Agent = LLM + 上下文 + 工具
```

对应三种理解：

| 工程视角 | 直觉类比 | 强化学习视角 |
| --- | --- | --- |
| LLM | 大脑 | Policy |
| 上下文 | 眼睛 | Observation Space |
| 工具 | 手脚 | Action Space |

## 原书要点

- 好的 Agent 设计应当从“感觉驱动”走向“原则驱动”。
- 真实、复杂、高风险的业务会倒逼系统建立可靠的工程机制。
- 没有评估，就无法区分系统是真的进步，还是偶然表现得更好。
- 全书从构建、评估与进化、交互与协作几个层次展开。

## 我的理解

待阅读后补充。

## 阅读路线

- [ ] 第 1 章：建立 Agent 的整体框架
- [ ] 第 2 章：重点学习上下文工程
- [ ] 第 3～5 章：学习知识、工具与 Coding Agent
- [ ] 第 6～8 章：建立评估和持续改进闭环
- [ ] 第 9～10 章：了解多模态和多 Agent 协作

## 延伸问题

- [ ] “真实业务反馈”可以怎样转化成可重复的评估数据？
- [ ] Harness、Skill 和 Loop Engineering 分别在系统中承担什么职责？

## 相关内容

- [原书引言](https://bojieli.github.io/ai-agent-book/book/introduction/)
- [原书代码仓库](https://github.com/bojieli/ai-agent-book)
- [第 1 章笔记](../01-agent-basics/README.md)

## 修订记录

- 2026-07-28：创建笔记。

