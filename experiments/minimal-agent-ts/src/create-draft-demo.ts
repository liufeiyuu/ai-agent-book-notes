// 导入执行器
import { executeToolCall } from "./tool-executor";
// 导入注册表
import { ToolRegistry } from "./tool-registry";
// 导入草稿工具工厂
import { createDraftTool } from "./tools/create-draft";

// drafts 保存“草稿 ID → 正文”的对应关系，刚创建时为空。
const drafts = new Map<string, string>();
// 先执行 createDraftTool(drafts)，得到工具对象，再把它放进注册表。
const registry = new ToolRegistry([createDraftTool(drafts)]);
const inputs = [
  { content: "  正文  " },
  { content: "" },
  { content: "   " },
  { content: 123 },
  {},
];

for (const [index, input] of inputs.entries()) {
  const result = await executeToolCall(registry, {
    id: `draft-case-${index + 1}`,
    name: "create_draft",
    arguments: input,
  });
  console.log(JSON.stringify({ input, result, draftCount: drafts.size }, null, 2));
}
console.log(JSON.stringify({ savedDrafts: [...drafts.entries()] }, null, 2));
