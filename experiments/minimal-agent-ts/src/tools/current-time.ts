import type { Tool } from "../types";

export type CurrentTimeArguments = {
  timeZone: string;
};

export type CurrentTimeOutput = {
  iso: string;
  timeZone: string;
  localTime: string;
};

export type CurrentTimeToolOptions = {
  now?: () => Date;
};

export function createCurrentTimeTool(
  options: CurrentTimeToolOptions = {},
): Tool<CurrentTimeArguments> {
  const now = options.now ?? (() => new Date());

  return {
    name: "current_time",
    description: "Get the current date and time in an IANA time zone.",
    inputSchema: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "An IANA time zone such as Asia/Shanghai or UTC.",
        },
      },
      required: ["timeZone"],
      additionalProperties: false,
    },

    parseArguments(input: unknown): CurrentTimeArguments {
      if (!isRecord(input)) {
        throw new TypeError("current_time arguments must be an object.");
      }
      if (typeof input.timeZone !== "string" || input.timeZone.trim() === "") {
        throw new TypeError("timeZone must be a non-empty IANA time zone.");
      }

      return { timeZone: input.timeZone };
    },

    async execute(arguments_, signal): Promise<CurrentTimeOutput> {
      signal?.throwIfAborted();
      const date = now();
      if (Number.isNaN(date.getTime())) {
        throw new RangeError("Clock returned an invalid date.");
      }

      const localTime = new Intl.DateTimeFormat("zh-CN", {
        timeZone: arguments_.timeZone,
        dateStyle: "full",
        timeStyle: "long",
        hour12: false,
      }).format(date);

      return {
        iso: date.toISOString(),
        timeZone: arguments_.timeZone,
        localTime,
      };
    },
  };
}

export const currentTime = createCurrentTimeTool();

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
