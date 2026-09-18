import type { Tool } from "../types";

const OPERATIONS = ["add", "subtract", "multiply", "divide"] as const;

export type CalculatorOperation = (typeof OPERATIONS)[number];

export type CalculatorArguments = {
  operation: CalculatorOperation;
  left: number;
  right: number;
};

// 计算器实现
// 这个项目只把工具名称、描述和 Schema 交给模型；校验函数和执行函数留在本地。
export const calculator: Tool<CalculatorArguments> = {
  // 告诉模型工具叫什么、有什么用途
  name: "calculator",
  description: "Perform one arithmetic operation on two finite numbers.",
  // 描述参数名称、类型和约束
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

  // 本地程序检查收到的参数
  parseArguments(input: unknown): CalculatorArguments {
    if (!isRecord(input)) {
      throw new TypeError("Calculator arguments must be an object.");
    }

    if (Object.keys(input).some((key) => !["operation", "left", "right"].includes(key))) {
      throw new TypeError("Only operation, left and right are allowed in calculator arguments.");
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

  // 本地程序执行实际运算
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
