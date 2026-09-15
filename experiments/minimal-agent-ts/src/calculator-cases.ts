import { executeToolCall } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import { calculator } from "./tools/calculator";
import type { ToolCall } from "./types";

// 直接提供工具调用参数，观察本地校验和执行；这里不请求模型。
const registry = new ToolRegistry([calculator]);
const calls: ToolCall[] = [
  {
    id: "case-1",
    name: "calculator",
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
  const result = await executeToolCall(registry, call);
  console.log(JSON.stringify({ input: call.arguments, result }, null, 2));
}
