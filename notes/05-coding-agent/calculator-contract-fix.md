# Coding 协作：让计算器实现遵守参数契约

2026-09-15，Stage 3 C。用户要求继续学习，助手从已有实验选取实际不一致并整理任务初稿；以下需求与代码由助手编写，学习者尚未核对初稿或说明验证边界，不记为学习者独立提出或完成。

## 任务说明初稿

**目标：**计算器只允许 operation、left、right 三个参数。输入额外 JSON 字段时，本地执行器应返回 invalid_arguments，而且不能进入实际计算；保持 Schema 中 additionalProperties: false 的既有约定。

**具体输入：**`{"operation":"divide","left":6,"right":3,"precision":2}`。当前本地解析会静默丢弃 precision，容易让调用者误以为精度参数生效；MCP Server 的 strict Schema 已会拒绝额外字段。本次修复本地参数校验，使其与声明一致，不引入精度功能。

**修改范围：**calculator.parseArguments 和直接验证此行为的测试。保留原运算、参数类型与有限数检查、除零错误、调用 ID 和原错误包装。无需修改 Agent Loop 或 MCP 协议层。

**验证条件：**额外字段返回 invalid_arguments，执行计数为 0；合法加减乘除继续得到正确结果；已有非法操作、非有限数与除零仍按原逻辑失败。

**交付物：**修改前后的实际检查结果、代码 diff、简短原因与验证范围说明。不能通过放宽 Schema 或让测试接受成功输出来消除失败。

## 当前执行状态

助手已按初稿完成复现、修复与验证；学习者任务审查与验证解释待反馈，C 尚未通过。没有真实模型调用，也未新增 MCP 协议调用。

## 实际过程与证据

| 操作 | 得到的证据与下一步 |
| --- | --- |
| 定位并读取 calculator.ts、已有计算器与执行器测试 | Schema 声明 additionalProperties: false；parseArguments 只取三个字段，未拒绝额外字段 |
| 新增行为测试，先在旧实现上运行 | 实际返回 ok: true、output: 2，执行计数 1；测试预期拒绝，退出码 1，确认缺陷可复现 |
| 在 parseArguments 中补字段检查 | 校验对象后立即拒绝三个允许字段之外的 JSON 键，沿用执行器的 invalid_arguments 包装；不修改 Schema 或计算逻辑 |
| 运行类型检查与 27 项相关测试 | 测试先通过，但类型检查发现测试辅助函数参数被推断为 Record；补明确类型后两项均通过，行为预期始终未放宽 |
| 审查实际 diff | 生产代码只增加额外字段检查；测试检查错误码、原调用 ID 及不进入执行；已有测试覆盖正常运算与原错误路径 |

- [修改前检查](../../experiments/minimal-agent-ts/artifacts/calculator-contract-before.json)：1 项契约测试失败，含实际成功结果与执行计数。
- [中间检查](../../experiments/minimal-agent-ts/artifacts/calculator-contract-intermediate.json)：27 项测试通过，类型检查失败；保留真实调试过程。
- [最终检查](../../experiments/minimal-agent-ts/artifacts/calculator-contract-after.json)：类型检查退出码 0，27 项相关测试全部通过。
- [源码与测试 diff](../../experiments/minimal-agent-ts/artifacts/calculator-contract-fix.patch)。
- [修改后的计算器](../../experiments/minimal-agent-ts/src/tools/calculator.ts)、[新增契约测试](../../experiments/minimal-agent-ts/tests/calculator-contract.test.ts)。

验证命令见上述记录，测试集合为 calculator-contract、calculator、tool-executor、agent、mcp-calculator-adapter。B 已通过的协议记录继续引用，未重跑全部 MCP 演示。

## 如何判断修改满足需求

本次修复有两类证据：新增测试证明“额外字段被拒绝且不执行”；原有检查证明已覆盖的正常运算及错误路径仍符合预期。只看到 6÷3=2 不能证明额外字段问题已经修复。测试通过只支持已覆盖案例，不能推出所有数值边界、所有工具或所有 MCP 场景均正确。

如果把 additionalProperties 改成 true，或让测试接受额外字段后成功计算，就改变了原任务预期，不能算完成本次修复。类型检查失败与测试失败分别定位处理，不能用一个通过掩盖另一个失败。

本例展示的 Coding 循环是：定位文件 → 读实现和约束 → 复现 → 局部修改 → 看检查反馈 → 修正必要问题 → 复验与审查。Coding Agent 和其他 Agent 都依靠工具行动并观察反馈；这里处理的是代码文件和测试，验收对象是用户要求的程序行为。未重建搜索、编辑、沙箱或 Agent 框架。

## 学习者接续

任务初稿由助手整理，等待学习者作为需求方审查，并说明：“只验证 6÷3 仍等于 2，能否证明这次修复成功；还需要哪条证据？”可以简短口述，不要求写代码或誊写需求。回答后按 C 既有标准判断是否收尾，不追加考试或实现要求。
