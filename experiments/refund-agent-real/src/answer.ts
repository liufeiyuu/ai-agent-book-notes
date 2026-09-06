import { record, type Answer } from "./types";

export const ANSWER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["status", "orderIds", "answer", "citations", "missingInformation"],
  properties: {
    status: { type: "string", enum: ["eligible", "ineligible", "needs_clarification", "insufficient_evidence"] },
    orderIds: { type: "array", items: { type: "string" } },
    answer: { type: "string" },
    citations: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["chunkId", "quote"],
      properties: { chunkId: { type: "string" }, quote: { type: "string" } },
    } },
    missingInformation: { type: "array", items: { type: "string" } },
  },
};

const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
// Validate even with provider-side structured output. Never extract a convenient JSON suffix.
export function parseAnswer(raw: string): Answer {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.keys(value).length !== 5 ||
      typeof value.status !== "string" || !ANSWER_SCHEMA.properties.status.enum.includes(value.status) ||
      !nonempty(value.answer) ||
      !Array.isArray(value.orderIds) || !value.orderIds.every(nonempty) ||
      !Array.isArray(value.missingInformation) || !value.missingInformation.every(nonempty) ||
      !Array.isArray(value.citations) || value.citations.some(x => !record(x) || Object.keys(x).length !== 2 ||
        !nonempty(x.chunkId) || !nonempty(x.quote))) {
    throw new Error("Final answer does not match the required JSON structure.");
  }
  return value as unknown as Answer;
}
