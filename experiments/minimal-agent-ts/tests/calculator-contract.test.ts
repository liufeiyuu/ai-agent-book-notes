import assert from "node:assert/strict";
import test from "node:test";
// 串起查找、校验、执行和结果包装。
import { executeToolCall } from "../src/tool-executor";
// 保存工具，让执行器能按名称找到它。
import { ToolRegistry } from "../src/tool-registry";
import { calculator, type CalculatorArguments } from "../src/tools/calculator";

test("extra JSON fields are rejected before calculator execution", async () => {
  // 注册一个能记录执行次数的计算器。
  let executions = 0;
  const registry = new ToolRegistry([{
    // ...calculator 把原工具的字段复制到新对象里，包括名称、Schema、参数校验函数等。
    // 后面同名的 execute 覆盖了复制来的执行函数。
    ...calculator,
    async execute(args: CalculatorArguments, signal?: AbortSignal) {
      // 于是，注册进去的工具仍然使用原来的校验逻辑，但执行时会先计数：
      executions += 1;
      return calculator.execute(args, signal);
    },
  }]);

  // 通过执行器发出一次带额外字段的请求。
  // 正常的三个参数之外，多了：precision
  const result = await executeToolCall(registry, {
    id: "extra-field-case", name: "calculator",
    arguments: { operation: "divide", left: 6, right: 3, precision: 2 },
  });
  // 验证：这次调用返回失败
  assert.equal(result.ok, false, JSON.stringify({ result, executions }));
  // 验证：失败原因是参数不合法
  assert.equal(result.error.code, "invalid_arguments");
  // 验证：返回结果正确对应这次请求
  assert.equal(result.toolCallId, "extra-field-case");
  // 验证：执行函数一次都没有进入
  assert.equal(executions, 0);
});
