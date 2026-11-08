"""六条人工编写的工具记录；名称和耗时都是教学数据，没有调用真实工具。"""

# 最外层 [] 是 list：保存一组有顺序的记录，允许同一工具出现多次。
# 每个 {} 是 dict：通过 call_id、tool、status、duration_ms 这些键取值。
# ID、工具名和状态是 str；duration_ms 是 int，单位为毫秒。
# 大写名称表示本项目把它当作固定样本使用，Python 本身不会禁止修改它。
SAMPLE_RECORDS = [
    {"call_id": "call-001", "tool": "lookup_order", "status": "succeeded", "duration_ms": 120},
    {"call_id": "call-002", "tool": "search_policy", "status": "failed", "duration_ms": 900},
    {"call_id": "call-003", "tool": "search_policy", "status": "failed", "duration_ms": 200},
    {"call_id": "call-004", "tool": "create_draft", "status": "succeeded", "duration_ms": 80},
    {"call_id": "call-005", "tool": "search_policy", "status": "succeeded", "duration_ms": 300},
    {"call_id": "call-006", "tool": "lookup_order", "status": "failed", "duration_ms": 1500},
]
