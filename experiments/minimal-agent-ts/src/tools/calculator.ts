import type { Tool } from "../types";

const OPERATIONS = ["add", "subtract", "multiply", "divide"] as const;

export type CalculatorOperation = (typeof OPERATIONS)[number];

export type CalculatorArguments = {
  operation: CalculatorOperation;
  left: number;
  right: number;
};

export const calculator: Tool<CalculatorArguments> = {
  name: "calculator",
  description: "Perform one arithmetic operation on two finite numbers.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: OPERATIONS,
        description: "The arithmetic operation to perform.",
      },
      left: {
        type: "number",
        description: "The left operand.",
      },
      right: {
        type: "number",
        description: "The right operand.",
      },
    },
    required: ["operation", "left", "right"],
    additionalProperties: false,
  },

  parseArguments(input: unknown): CalculatorArguments {
    if (!isRecord(input)) {
      throw new TypeError("Calculator arguments must be an object.");
    }

    const { operation, left, right } = input;

    if (!isCalculatorOperation(operation)) {
      throw new TypeError(
        `operation must be one of: ${OPERATIONS.join(", ")}.`,
      );
    }

    if (!isFiniteNumber(left) || !isFiniteNumber(right)) {
      throw new TypeError("left and right must be finite numbers.");
    }

    return { operation, left, right };
  },

  async execute(arguments_, signal): Promise<number> {
    signal?.throwIfAborted();

    const { operation, left, right } = arguments_;

    switch (operation) {
      case "add":
        return left + right;
      case "subtract":
        return left - right;
      case "multiply":
        return left * right;
      case "divide":
        if (right === 0) {
          throw new RangeError("Cannot divide by zero.");
        }
        return left / right;
    }
  },
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isCalculatorOperation(input: unknown): input is CalculatorOperation {
  return (
    typeof input === "string" &&
    (OPERATIONS as readonly string[]).includes(input)
  );
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}
