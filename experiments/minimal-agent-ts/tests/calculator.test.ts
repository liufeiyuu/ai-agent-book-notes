// 检查实际结果是否符合预期，不符合就让测试失败。
import assert from "node:assert/strict";
// 定义测试用例。
import test from "node:test";
// 实际要测试的工具。
import { calculator } from "../src/tools/calculator";

test("parses and executes supported operations", async () => {
  const cases = [
    [{ operation: "add", left: 7, right: 5 }, 12],
    [{ operation: "subtract", left: 7, right: 5 }, 2],
    [{ operation: "multiply", left: 7, right: 5 }, 35],
    [{ operation: "divide", left: 10, right: 4 }, 2.5],
  ] as const;

  for (const [input, expected] of cases) {
    const arguments_ = calculator.parseArguments(input);
    assert.equal(await calculator.execute(arguments_), expected);
  }
});

// 这三个测试都在检查：遇到不该正常执行的情况，工具有没有按预期失败。 因此，抛出预期错误会让测试通过。
test("rejects malformed arguments before execution", () => {
  assert.throws(
    // 第一个参数是一个尚未执行的函数。assert.throws 会调用它，并检查它是否同步抛错。
    // 如果直接写 calculator.parseArguments(...)，它会在传参时先执行，错误就发生在 assert.throws 接手之前了。
    () => calculator.parseArguments({ operation: "power", left: 2, right: 3 }),
    // 第二个参数是正则表达式，用来匹配错误消息。没有抛错，或者错误消息不匹配，测试都会失败。
    /operation must be one of/,
  );
  assert.throws(
    () => calculator.parseArguments({ operation: "add", left: NaN, right: 3 }),
    /left and right must be finite numbers/,
  );
});

test("rejects division by zero during execution", async () => {
  const arguments_ = calculator.parseArguments({
    operation: "divide",
    left: 10,
    right: 0,
  });

  // 检查执行阶段返回的 Promise 是否失败，错误消息是否包含 Cannot divide by zero。
  await assert.rejects(
    calculator.execute(arguments_),
    /Cannot divide by zero/,
  );
});

// 取消测试
test("honors an already-aborted signal", async () => {
  // 首先创建取消控制器，并立即取消
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    calculator.execute(
      { operation: "add", left: 1, right: 2 },
      controller.signal,
    ),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
});
