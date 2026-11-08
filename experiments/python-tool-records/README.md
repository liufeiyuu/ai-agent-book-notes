# Python 工具记录小项目

Stage 5 的贯穿项目。C1 建立环境与入口，C2 在同一入口加入虚构记录的筛选、按工具汇总和一条规则对照；文件读取与完整校验尚未实现。学习状态、双方贡献和下一步统一见 [Stage 5 计划](../../notes/stage-05-plan.md#执行进度)。

## C1 的问题与环境

要验证：项目使用指定 Python 和自己的依赖目录；明确执行包入口才启动 CLI，导入业务模块不自动调用其中的 `main()`。

2026-10-23 助手实际检查：当前 shell 的 `python3` 对应 Apple Command Line Tools 的 3.9.6；另有 `/opt/homebrew/bin/python3.12`，版本 3.12.14。本项目以已有 3.12 创建 `.venv`，没有安装或升级系统 Python。创建前本仓库未发现 `pyvenv.cfg`；不据此声称整台机器不存在其他环境。

入口只使用标准库与本项目代码：C1 用 `sys` 展示环境，C2 用 `json` 展示处理结果。创建虚拟环境时由 `venv` 引导安装其自带的 pip；未从网络安装业务依赖，pytest 尚未安装。`.venv` 与 `__pycache__` 已被仓库根目录的 `.gitignore` 排除。

## 运行方法

在这个项目目录创建环境的实际命令（已经执行过，日常运行无需重复创建）：

```sh
cd /Users/taikongren/Desktop/workspace/ai-agent-book-notes/experiments/python-tool-records
/opt/homebrew/bin/python3.12 -m venv .venv
```

直接指定环境运行：

```sh
cd /Users/taikongren/Desktop/workspace/ai-agent-book-notes/experiments/python-tool-records
.venv/bin/python -m tool_records
.venv/bin/python -m pip --version
```

也可以在当前终端先激活，再使用短命令：

```sh
cd /Users/taikongren/Desktop/workspace/ai-agent-book-notes/experiments/python-tool-records
source .venv/bin/activate
python -m tool_records
python -m pip --version
deactivate
```

激活只改变当前 shell 的命令查找环境；新终端需要重新激活，或直接使用 `.venv/bin/python`。`deactivate` 退出激活，不删除环境和依赖。`python -m pip` 表示由这一个 Python 运行 pip，便于核对安装位置。

## 入口结构：C1 建立，C2 复用

```text
.venv/bin/python -m tool_records
  → tool_records/__main__.py
  → 从 cli.py 导入 main
  → 调用 main()
  → 取样本、处理并打印报告（C2）
```

- [`__main__.py`](./tool_records/__main__.py)：`-m tool_records` 执行这个包入口；`from .cli import main` 取出函数，后面的 `main()` 才调用它。
- [`cli.py`](./tool_records/cli.py)：定义实际的 `main`；C2 中取样本、调用处理函数并展示结果。函数名是本项目的普通命名，不因名字叫 main 就自动运行。
- [`__init__.py`](./tool_records/__init__.py)：标识这里使用的普通 Python 包；目前只有说明，没有启动 CLI 的代码。

C1 保存时的实际输出（C2 后同一命令改为输出下方两份报告）：

```text
工具记录项目：入口已启动
Python 版本：3.12.14
解释器路径：/Users/taikongren/Desktop/workspace/ai-agent-book-notes/experiments/python-tool-records/.venv/bin/python
```

这份历史输出只证明 C1 环境与入口，C2 的处理证据单独保存。

## C1 实际验证与失败对照

[C1 命令与完整输出](./artifacts/c1-environment-2026-10-23.json)保存了助手执行的命令、工作目录、退出码和输出：

- 直接指定解释器与激活后运行均成功，打印相同的项目解释器路径。
- 环境内 `sys.prefix != sys.base_prefix`；依赖目录为本项目 `.venv/lib/python3.12/site-packages`，配置 `include-system-site-packages = false`。直接指定解释器时即使 `VIRTUAL_ENV` 为空，也实际使用了虚拟环境。
- `python -m pip --version` 指向同一 `.venv` 内的 pip 26.2.1。
- `import tool_records.cli` 成功且没有输出，因为这里只定义了函数，未调用入口；不能推广为所有 import 都没有执行语句或副作用。
- `import pytest` 实际以退出码 1 产生 `ModuleNotFoundError: No module named 'pytest'`，这是预期的缺依赖对照。`import` 使用当前环境能找到的模块，不会自动下载包；本轮不需要安装 pytest。
- 退出激活后，当前测试 shell 的 `python3` 再次解析为 `/usr/bin/python3`。没有永久改动 PATH 或其他项目配置。

以上是助手运行证据，不是学习者亲跑或理解完成证据；没有模型、工具服务或网络业务调用。

## C1 资料范围

先对照 [Python 3.12 教程 12.1–12.2](https://docs.python.org/zh-cn/3.12/tutorial/venv.html)理解依赖版本冲突与环境创建，再看 12.3 开头的 pip 用途；包版本清单、发布与锁定机制按需查阅。[venv 文档](https://docs.python.org/3.12/library/venv.html)用于核对激活、解释器与依赖目录；只取使用部分，不读 EnvBuilder 实现。

模块概念对应[教程第 6 章开头](https://docs.python.org/zh-cn/3.12/tutorial/modules.html)，包入口对应 [`__main__.py` 的官方说明](https://docs.python.org/3.12/library/__main__.html#main-py-in-python-packages)。这些链接解释机制；本机版本和实际结果以本地命令证据为准。

## C2：同一份数据怎样变成报告

先看官方资料中的几个对应关系：[数据结构](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html)只取 5.1 的列表与 append、5.4 集合、5.5 字典；[控制流](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html)只取 4.1 if、4.2 for、4.8 函数以及默认值/关键字参数的基本用法。列表保存有序多条记录，字典按键取字段或分组结果，集合保存不重复的名称；函数接收输入并返回结果，调用方决定是否打印。推导式、复杂参数、类与完整异常处理按需或后续学习。

### 输入与实际结果

[`samples.py`](./tool_records/samples.py)中保存一份人工编写的 Python 列表，每条是字典。它不是从 JSON 文件读入的，也不是真实工具调用 Trace；耗时是虚构字段，不是程序实测运行时间。

| call_id | tool | status | duration_ms |
| --- | --- | --- | --- |
| call-001 | lookup_order | succeeded | 120 |
| call-002 | search_policy | failed | 900 |
| call-003 | search_policy | failed | 200 |
| call-004 | create_draft | succeeded | 80 |
| call-005 | search_policy | succeeded | 300 |
| call-006 | lookup_order | failed | 1500 |

本轮先实现“全部失败”并实际运行，再修改筛选函数增加 `min_duration_ms=0` 和耗时判断。默认下限 0 对本课非负耗时样本保持原行为，传 500 时变为“失败且耗时至少 500 毫秒”。规则变体由助手选取并实现，尚无学习者独立设计或理解确认。

| 范围 | 选中的 ID | search_policy 汇总 | lookup_order 汇总 |
| --- | --- | --- | --- |
| 修改前的全部失败 / 修改后默认下限 0 | call-002、call-003、call-006 | 2 条，1100 毫秒 | 1 条，1500 毫秒 |
| 修改后下限 500 | call-002、call-006 | 1 条，900 毫秒 | 1 条，1500 毫秒 |

汇总口径只包含筛选后记录。`create_draft` 没有选中的失败，所以不出现在分组结果中。耗时求和只是这些字段值相加，不表示端到端延迟或实际工具性能。

### 五处关键位置与同一条数据

```text
samples.SAMPLE_RECORDS（六条记录）
  → cli.main 调用 build_report
  → select_failed 返回 selected 列表
  → 提取 ID，用 set 去重工具名
  → summarize_by_tool(selected) 返回分组字典
  → build_report 返回报告字典
  → cli.main 用 json.dumps 转成文字并 print
```

1. `samples.py:7`：外层 `[]` 是列表，每条 `{...}` 是字典。例如 `SAMPLE_RECORDS[1]["duration_ms"]` 为 900；列表从 0 开始索引，字典按字段名取值。
2. `cli.py:13/:14`：同一列表传给 `build_report` 两次。第二次的 `min_duration_ms=500` 是按参数名传值；不传时用默认 0。`SAMPLE_RECORDS` 全大写只是固定样本的命名约定，不会被 Python 自动变成不可修改对象。
3. `processing.py:7` 的 `select_failed`：for 按顺序取一条记录，if 判断两个条件，append 收集满足条件的字典。call-002 为 failed 且 900≥500，因此保留；call-003 虽失败但 200<500，因此不进入第二份结果。return 位于循环外，处理完所有记录才返回。
4. `processing.py:21` 的 `summarize_by_tool`：第一次遇到 search_policy，建立 count=0、total_duration_ms=0；处理 call-002 后为 1、900。基线中再处理 call-003 变成 2、1100；下限 500 的结果不含 call-003，故保持 1、900。`stats = summary[tool]` 指向同一统计字典，修改 stats 会反映在 summary 中。
5. `processing.py:36` 的 `build_report`：串起筛选、ID 收集、工具去重和分组汇总，再返回报告；`cli.py:20` 才负责打印。基线选中三条，但 set 中只有 lookup_order 和 search_policy 两个名字；展示时用 sorted 转成稳定的列表。空列表是 `[]`，空字典是 `{}`，空集合是 `set()`。

处理函数不改写输入。筛选创建了新列表，但列表里的字典仍引用原记录；这不是深复制。本例只读取这些记录，累计值存入新建的统计字典，因此同一份输入可以用于两种规则对照。

### 必要验证与一个失败位置

- [修改前实际输出和源码快照](./artifacts/c2-before-2026-10-23.json)：全部失败为 3 条，分组与预期一致。
- [修改后输出与 9 项检查](./artifacts/c2-after-2026-10-23.json)：默认行为保留、下限 500 的结果正确、500 本身被包含、空输入、耗时很高的成功仍被排除、输入未改写、导入模块仍不启动 CLI、缺字段报错以及样本文件前后哈希相同，均符合预期。它们是助手的必要离线检查，未安装或运行 pytest。
- 实际构造一条缺少 duration_ms 的失败记录后，在 `select_failed` 读取 `record["duration_ms"]` 时产生 `KeyError: 'duration_ms'`，沿 `build_report` 向调用方传播，未产生报告。这说明当前函数依赖输入契约，并不具备完整外部输入校验；C4 再加入明确校验与错误反馈。本次只定位这一处，不展开异常处理课程。

运行方式仍为项目目录里的 `.venv/bin/python -m tool_records`，当前会打印两份报告。C2 前后各运行入口一次，无失败重跑；缺字段是有意构造的预期错误。没有调用任何真实工具、模型或外部业务接口，也没有新增依赖。
