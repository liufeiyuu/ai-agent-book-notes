import { executeToolCall } from "./tool-executor";
import { ToolRegistry } from "./tool-registry";
import { createDraftTool } from "./tools/create-draft";

const drafts = new Map<string, string>();
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
