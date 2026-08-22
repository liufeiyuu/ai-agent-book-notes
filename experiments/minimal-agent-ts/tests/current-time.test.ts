import assert from "node:assert/strict";
import test from "node:test";

import { createCurrentTimeTool } from "../src/tools/current-time";

test("returns an injected time in the requested time zone", async () => {
  const tool = createCurrentTimeTool({
    now: () => new Date("2026-08-22T00:00:00.000Z"),
  });
  const arguments_ = tool.parseArguments({ timeZone: "Asia/Shanghai" });
  const output = await tool.execute(arguments_);

  assert.ok(isCurrentTimeOutput(output));
  assert.equal(output.iso, "2026-08-22T00:00:00.000Z");
  assert.equal(output.timeZone, "Asia/Shanghai");
  assert.match(output.localTime, /2026年8月22日/);
  assert.match(output.localTime, /08:00:00/);
});

test("rejects missing timeZone before execution", () => {
  const tool = createCurrentTimeTool();

  assert.throws(() => tool.parseArguments({}), /timeZone/);
});

test("rejects an unknown time zone during execution", async () => {
  const tool = createCurrentTimeTool();
  const arguments_ = tool.parseArguments({ timeZone: "Mars/Olympus" });

  await assert.rejects(tool.execute(arguments_), /time zone/i);
});

function isCurrentTimeOutput(input: unknown): input is {
  iso: string;
  timeZone: string;
  localTime: string;
} {
  return (
    typeof input === "object" &&
    input !== null &&
    "iso" in input &&
    typeof input.iso === "string" &&
    "timeZone" in input &&
    typeof input.timeZone === "string" &&
    "localTime" in input &&
    typeof input.localTime === "string"
  );
}
