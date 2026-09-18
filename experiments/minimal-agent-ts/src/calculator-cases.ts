// 执行工具的函数
import { executeToolCall } from "./tool-executor";
// 管理工具的注册表
import { ToolRegistry } from "./tool-registry";
import { calculator } from "./tools/calculator";
import type { ToolCall } from "./types";

// 直接提供工具调用参数，观察本地校验和执行；这里不请求模型。
// 把 calculator 放进注册表。以后收到工具名 "calculator"，执行器就能从注册表找到对应实现。注册只是让工具可被找到，还没有进行计算。
const registry = new ToolRegistry([calculator]);

// 准备调用数据
const calls: ToolCall[] = [
  {
    // id 标识哪一次调用，方便把结果与请求对应起来。
    id: "case-1",
    // name 指定调用哪个工具。三次都使用同一个计算器。
    name: "calculator",
    // arguments 才是传给计算器的业务参数。
    arguments: { operation: "divide", left: 6, right: 3 },
  },
  {
    id: "case-2",
    name: "calculator",
    arguments: { operation: "divide", left: 6, right: 3 },
  },
  {
    id: "case-3",
    name: "calculator",
    arguments: { operation: "divide", left: 6, right: 0 },
  },
];

for (const call of calls) {
  // 把注册表和当前调用交给 executeToolCall。
  // await 等待本次处理结束，取得结果。
  const result = await executeToolCall(registry, call);
  console.log(JSON.stringify({ input: call.arguments, result }, null, 2));
}
