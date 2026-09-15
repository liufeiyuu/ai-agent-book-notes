import assert from "node:assert/strict";
import test from "node:test";
import { executeToolCall } from "../src/tool-executor";
import { ToolRegistry } from "../src/tool-registry";
import { createDraftTool } from "../src/tools/create-draft";

test("draft calls preserve content and create distinct retrievable records", async () => {
  const drafts = new Map<string, string>();
  const registry = new ToolRegistry([createDraftTool(drafts)]);
  const ids: string[] = [];
  for (const content of ["  正文  ", "第二份草稿"]) {
    const result = await executeToolCall(registry, {
      id: `call-${ids.length}`, name: "create_draft", arguments: { content },
    });
    assert.equal(result.ok, true);
    const { draftId } = result.output as { draftId: string };
    assert.equal(typeof draftId, "string");
    assert.ok(draftId.length > 0);
    assert.equal(drafts.get(draftId), content);
    ids.push(draftId);
  }
  assert.notEqual(ids[0], ids[1]);
  assert.equal(drafts.size, 2);
});

test("invalid arguments return structured errors without changing existing drafts", async () => {
  const drafts = new Map([["existing", "已有正文"]]);
  const registry = new ToolRegistry([createDraftTool(drafts)]);
  for (const input of [null, [], {}, { content: 123 }, { content: "" },
    { content: " \t\n " }, { content: "正文", path: "x" }]) {
    const result = await executeToolCall(registry, {
      id: "invalid", name: "create_draft", arguments: input,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_arguments");
    assert.deepEqual([...drafts], [["existing", "已有正文"]]);
  }
});
