# 官方 async-agent：Stage 4 A2 离线最小路径

目标：沿同一任务观察“启动 → 中途补充与查询 → 完成或取消 → 下一轮处理”。本实验运行官方 Python 核心代码，助手只补离线入口、样本、日志观察和验收检查。学习状态只在 [Stage 4 执行进度](../../notes/stage-04-plan.md#执行进度)维护。

## 来源与本地改动边界

- 来源：[Bojie Li / ai-agent-book，chapter6/async-agent](https://github.com/bojieli/ai-agent-book/tree/dbc046eb896ac4e39aa19c7774c8bf49583b89a6/chapter6/async-agent)，固定提交 `dbc046eb896ac4e39aa19c7774c8bf49583b89a6`，2026-10-11 获取。
- `upstream/` 下 `events.py`、`tasks.py`、`runtime.py`、`analysis_worker.py` 均为未修改的官方源文件。保留上游 [Apache 2.0 LICENSE](upstream/LICENSE)（Copyright 2025 Bojie Li）；[来源清单与 SHA-256](upstream-manifest.json)在每次运行前核对。
- 本地新增 [run_offline.py](run_offline.py)：脚本化客户端、场景输入、观察日志及结果检查。通过客户端注入复用官方 `AgentRuntime`，没有重写调度器或任务管理器；观察子类只记录日志和轨迹追加时间。
- 本地把 `tasks.DEFAULT_INPUT` 配置为 [5 行样本](fixtures/sample.md)，把 `TICK_REAL` 配置为 `0.15` 秒。官方默认分析 `book/chapter4.md`，因此这次文件统计属于本地样本，不是第四章全文；未改动上游文件字节。
- **真实部分**：事件队列、工具调用、子进程、文件分析、任务状态、进程退出和最终请求消息。**受控部分**：模型决策与措辞由脚本产生；进度按定时步长增长，全部进度结束后才进行文件统计，百分比不是实际文件扫描比例。
- 没有安装依赖、读取 API key、调用模型或联网执行。上游日志中的“LLM 调用耗时”在本入口指脚本客户端及其人为等待，不能当成模型延迟。上游 README 部分旧文字称终端任务为模拟；本版本 `tasks.py` 实际使用 `create_subprocess_exec`，以源码和本次回执为准。

## 运行

需要 Python 3.9 或更新版本，仅标准库；本机验证为 macOS / Python 3.9.6。从仓库根目录运行：

```bash
python3 experiments/async-agent-official/run_offline.py
```

约 10 秒依次运行 `complete`、`cancel`、`late-cancel` 三组对照；每组创建独立运行时，故都会从 `T1` 开始，跨组须结合场景名/PID 区分。输入由驱动按真实任务进度提交，无需抢着键入。这里用户“亲跑”指学习者自己启动入口并核对输出；助手代跑单独记载。

首次先运行上面的默认对照。之后若要亲自改变一次取消时机，只改参数：

```bash
python3 experiments/async-agent-official/run_offline.py --scenario cancel --cancel-at 70
```

阈值允许 30–80，默认 40；每步增加 4.5%，因此实际取消进度会取首次达到阈值时的观测值（例如本次 40.5%），还受调度影响，不承诺精确到某个百分比。命令执行失败或错过中途窗口会报错，不会当成通过。

每次写到新的 `runs/<时间戳>/`；也可用 `--output <新目录>` 指定，已有目录会拒绝覆盖。每个场景有可读 `.log`、完整请求与事件顺序 `.jsonl`、状态与检查 `.json`，全部成功后另存 `summary.json`。日志与结果中的本机绝对路径用于追溯当次证据。

## 已有运行证据：先看行为

2026-10-11 助手运行三组对照，**3/3 通过，29 项检查通过**，3 个真实子进程，16 次脚本客户端调用，真实 LLM 调用为 0。入口首轮运行成功，无失败重跑。[汇总](runs/2026-10-11-assistant/summary.json)。

输入相同：启动分析 → 进度达到约 22.5% 时补充“最终只列行数和标题数。” → 查询“现在进度多少？”。区别只在后续取消时机。

| 场景 | 关键实际行为 | 最终任务状态与结果 |
| --- | --- | --- |
| [正常完成](runs/2026-10-11-assistant/complete.log) | 约 0.01s 返回任务句柄；0.92s 补充进入 pending；0.95s 已回复 running；3.75s 完成事件与补充一起入轨迹 | `completed`，PID 39380，退出码 0；3.76s 输出“行数=5；标题数=2” |
| [途中取消](runs/2026-10-11-assistant/cancel.log) | 约 1.55s 发送取消，1.56s 子进程终止；实际进度 40.5% | `cancelled`，PID 39437，退出码 -15；无完成事件、无分析结果 |
| [结果之后取消](runs/2026-10-11-assistant/late-cancel.log) | 约 3.75s 已输出结果，3.76s 再发送取消，取消清单为空 | 仍为 `completed`，PID 39465，退出码 0；已有结果保留 |

不要把这三层完成合为一层：启动工具返回了 `T1`，只说明后台任务已登记；子进程正常退出后任务才是 `completed`；结果进入后续请求并输出摘要，是这次用户请求的最后一步。原计划的通用 `succeeded` 在这份官方任务实现中叫 `completed`。

## 沿同一份数据看五处关键代码

```text
用户输入 → inbox → dispatcher ──即时事件──→ work → worker → trajectory → 客户端请求
                       └──普通补充──→ pending ────────────┘（完成时合批）
启动工具 → TaskManager → 真实子进程 → 完成回调 → inbox
取消输入 → dispatcher → 取消当前 turn 与后台协程 → 终止子进程
```

1. **先返回任务句柄。** [runtime.py](upstream/runtime.py) 的 `_exec_tool`（312 行）调用 [tasks.py](upstream/tasks.py) 的 `start`（106 行）。`start` 校验白名单和输入文件，分配 `T1`，用 `asyncio.create_task(self._run(...))` 安排后台执行，立即返回 `TaskState`；没有等待分析结束。真正创建 OS 子进程在 `_run` 的 151 行。启动回执因此没有“行数=5”这种最终统计。

2. **输入到达与处理分开。** [runtime.py](upstream/runtime.py) 的 `submit_user_message`（156 行）只构造事件并放入 `inbox`。本例补充句没有疑问或取消信号，被 [events.py](upstream/events.py) 的简单关键词规则归为 `deferred`；查询句归为 `immediate`。这是教学分类规则，不是模型理解，也不适合作为一般语义保证。

3. **决定什么时候使用输入。** [runtime.py](upstream/runtime.py) 的 `_dispatcher`（198 行）在任务运行时把普通补充放进 `pending`，把即时查询送进 `work`。本次查询请求中确实没有“最终只列行数和标题数”；查询工具返回当时的 `running` 与进度。`immediate` 代表直接进工作队列，不保证抢占正在生成的另一个回复；工作协程仍逐批执行。

4. **真实结果接回下一轮。** [runtime.py](upstream/runtime.py) 的 `_on_task_complete`（170 行）把带同一 `T1` 的统计包装为 `async.result`，重新放进 `inbox`。分派器构造 `[完成事件] + pending`，工作协程在 `_process_batch`（258 行）统一追加轨迹，`build_messages` 再构造请求。对照 [complete.jsonl](runs/2026-10-11-assistant/complete.jsonl) 中最后一条 `scripted_request`：既有结果，也有补充；脚本依据真实统计输出两个字段。**收到补充并不等于当时的请求已经使用它，也不会自动修改已经发出的子进程参数。**

5. **取消沿执行链传递。** [runtime.py](upstream/runtime.py) 的 `_handle_interrupt`（229 行）取消当前 turn、调用 `cancel_all` 并排入打断回执。[tasks.py](upstream/tasks.py) 的 `except asyncio.CancelledError`（207 行）进一步调用 `_terminate_process`，终止并等待 OS 子进程，然后写入 `cancelled`。所以回执称“取消了任务”只是调度层发出取消；本次真正的终止证据是进程对象已退出及 `returncode=-15`。晚到取消面对的是已完成任务，取消清单为空，也不会撤销现有结果。

这里还有一个必须按代码解释的细节：取消分支也会把 `pending` 追加到轨迹。原注释虽写“被丢弃的积压事件（留痕）”，实际消息仍进入下一次请求；不能讲成这些补充已从上下文删除。本地脚本明确优先处理取消，不把旧补充解释为重新开始工作。

## 检查支持的结论与边界

[run_offline.py](run_offline.py) 的 `verify`（131 行）检查任务关联、运行中返回、查询请求的消息可见性、查询先于任务结束、结果和补充共同进入后续请求、已知样本统计、进程退出，以及两种取消时机的差别；完成场景同时核对输入哈希。`.jsonl` 的 `seq` 是观察顺序，`trajectory_append` 是真正追加时间；事件自身 `ts` 是创建时间，不能用它替代追加顺序。

验证的是这些受控场景中的官方运行机制。格式选择与工具选择由脚本设定，不能证明真实模型自主调度、遵循补充或理解取消；没有验证模型生成过程中打断、任意竞态、多任务隔离、进程崩溃恢复、任意工具失败回传或生产可靠性。官方源码中的检查点功能未运行，不属于本轮要求。

本轮代表性非成功路径到“途中取消并确认子进程退出”即止。序列化、日志颜色、其他工具、检查点与辅助函数按需查阅，不要求逐个读完。学习者亲跑与理解反馈仍须在阶段计划中单独记录，不能用助手这次 29 项检查代替。
