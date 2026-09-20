# 实验记录

每个实验使用独立目录，并至少包含一份 `README.md`，记录：

- 实验目标与假设
- 环境和依赖
- 可复现的运行方法
- 结果、失败和排查过程
- 最终结论

开始新实验时，可以复制 [`templates/experiment-template.md`](../templates/experiment-template.md)。

## 实验列表

- [最小 Agent（TypeScript）](./minimal-agent-ts/README.md)
- [上下文压缩最小对照实验](./context-compression-minimal/README.md)
- [RAG 检索与重排序最小对照实验](./rag-retrieval-minimal/README.md)
- [用户记忆最小闭环（TypeScript）](./user-memory-minimal/README.md)：两小时补充学习；助手真实记忆闭环已验证，学习者实践进行中，进度见实验记录与学习计划。
- [真实模型退款咨询 Agent（TypeScript）](./refund-agent-real/README.md)：Stage 2 补充实战，固定 RAG 与 Agent 两种入口；含分步带学指南。Qwen + DeepSeek V4 最终真实验收均 6/6，30 个离线测试通过；Agent 包含一次有界格式恢复。实现已验收，待带学理解。
