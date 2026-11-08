"""命令行入口负责取样本、调用处理函数和展示结果。"""

# json 属于标准库；这里只把内存结果转成文字，还没有读取 JSON 文件。
import json

from .processing import build_report
from .samples import SAMPLE_RECORDS


def main():
    # 函数收到样本列表并返回结果字典；返回结果本身不会自动打印。
    # 不传下限时使用默认值 0；显式传 500 时，只保留耗时至少 500 毫秒的失败。
    all_failures = build_report(SAMPLE_RECORDS)
    slower_failures = build_report(SAMPLE_RECORDS, min_duration_ms=500)
    # 同一份样本调用两次，只有筛选规则参数不同；原样本不被处理函数修改。
    comparison = {
        "all_failures": all_failures,
        "failures_at_least_500_ms": slower_failures,
    }
    print(json.dumps(comparison, ensure_ascii=False, indent=2))
