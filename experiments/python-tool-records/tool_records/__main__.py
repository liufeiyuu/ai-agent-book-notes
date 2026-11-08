"""执行 python -m tool_records 时，从这里进入程序。"""

# 点号表示当前包：从同一 tool_records 包内的 cli.py 取出 main。
from .cli import main

# main 是我们定义的普通函数，由这里明确调用才开始工作。
main()
