"""C2 的内存数据处理：输入是本课字段齐全、耗时非负的记录。

本轮先理解数据和函数；外部输入的完整校验、文件和异常处理留给 C4。
"""


def select_failed(records, min_duration_ms=0):
    """按原顺序取出达到耗时下限的失败记录，返回一个新列表。"""
    selected = []
    # for 每轮取一条字典；冒号和缩进表示循环、条件所属的代码块。
    for record in records:
        # 原规则只判断 failed；现在要求“失败”与“耗时达到下限”同时成立。
        # 默认下限为 0：对本课非负耗时样本，仍保留全部失败记录。
        if record["status"] == "failed" and record["duration_ms"] >= min_duration_ms:
            # append 把这一条放入新列表；这里不修改原记录里的字段。
            selected.append(record)
    # return 在循环外：处理完全部记录后，才把结果交给调用方。
    return selected


def summarize_by_tool(records):
    """按工具名分组，统计传入记录的条数与耗时之和。"""
    summary = {}
    for record in records:
        tool = record["tool"]
        # 字典的键就是工具名；第一次遇到该工具，先建立它自己的统计项。
        if tool not in summary:
            summary[tool] = {"count": 0, "total_duration_ms": 0}
        # stats 指向 summary 中的同一个统计字典，不是另复制了一份。
        stats = summary[tool]
        stats["count"] += 1
        stats["total_duration_ms"] += record["duration_ms"]
    return summary


def build_report(records, min_duration_ms=0):
    """组织处理流程并返回结果字典；打印由 cli.main 负责。"""
    # 用关键字传参，把调用方选择的下限交给筛选函数。
    selected = select_failed(records, min_duration_ms=min_duration_ms)
    selected_ids = []
    # set 用于去重；空集合写 set()，{} 在这里会得到空字典。
    tool_names = set()
    for record in selected:
        selected_ids.append(record["call_id"])
        tool_names.add(record["tool"])

    return {
        "input_count": len(records),
        "selected_count": len(selected),
        "selected_ids": selected_ids,
        # 集合不表达业务顺序；转成排序后的列表，展示稳定且便于 JSON 输出。
        "tools": sorted(tool_names),
        # 传入的是筛选后的 selected，所以统计口径也只包含选中的失败。
        "by_tool": summarize_by_tool(selected),
    }
