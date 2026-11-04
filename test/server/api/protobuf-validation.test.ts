import { describe, expect, test } from "bun:test";
import { type DescMessage, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { UpdateCheckinRequestSchema } from "../../../src/gen/dashboardify/v1/day_pb";
import { CreateMessageRequestSchema } from "../../../src/gen/dashboardify/v1/message_pb";
import { MergeSamplesRequestSchema } from "../../../src/gen/dashboardify/v1/sample_pb";
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
} from "../../../src/gen/dashboardify/v1/task_pb";
import { validateMessage } from "../../../src/server/api/protobuf-validation";

describe("schema validation", () => {
  test("requires create payloads and nested descriptions", () => {
    expect(() => validateJson(CreateTaskRequestSchema, {})).toThrow();
    expect(() => validateJson(CreateTaskRequestSchema, { task: {} })).toThrow();
    expect(() => validateJson(CreateTaskRequestSchema, { task: { description: "   " } })).toThrow();
    expect(() =>
      validateJson(CreateTaskRequestSchema, { task: { description: "x".repeat(20001) } }),
    ).toThrow();
  });

  test("partial updates may omit descriptions but cannot clear them with a mask", () => {
    const task = { name: "tasks/one", dueDate: { year: 2026, month: 11, day: 3 } };

    expect(() =>
      validateJson(UpdateTaskRequestSchema, { task, updateMask: "dueDate" }),
    ).not.toThrow();
    expect(() =>
      validateJson(UpdateTaskRequestSchema, { task, updateMask: "description" }),
    ).toThrow();
    expect(() =>
      validateJson(UpdateTaskRequestSchema, { task: { description: "No name" } }),
    ).toThrow();
  });

  test("checks optional score ranges without rejecting a zero effort score", () => {
    const name = "days/2026-11-03/checkin";

    expect(() =>
      validateJson(UpdateCheckinRequestSchema, { checkin: { name, rpe: 0 } }),
    ).not.toThrow();
    expect(() =>
      validateJson(UpdateCheckinRequestSchema, { checkin: { name, feel: 6 } }),
    ).toThrow();
    expect(() =>
      validateJson(UpdateCheckinRequestSchema, { checkin: { name, rpe: -1 } }),
    ).toThrow();
    expect(() =>
      validateJson(UpdateCheckinRequestSchema, { checkin: { name, tags: ["INVALID"] } }),
    ).toThrow();
  });

  test("requires a received timestamp before a message reaches storage", () => {
    expect(() =>
      validateJson(CreateMessageRequestSchema, { message: { sender: "Alice", text: "Hello" } }),
    ).toThrow();
  });

  test("requires a nonempty sample batch and a typed values alternative", () => {
    const batch = {
      stream: "streams/heart_rate",
      day: { year: 2026, month: 11, day: 3 },
      timestamps: ["1793664000000"],
    };

    expect(() => validateJson(MergeSamplesRequestSchema, { ...batch, columns: [] })).toThrow();
    expect(() =>
      validateJson(MergeSamplesRequestSchema, { ...batch, columns: [{ name: "bpm" }] }),
    ).toThrow();
    expect(() =>
      validateJson(MergeSamplesRequestSchema, {
        ...batch,
        columns: [{ name: "bpm", numbers: { values: ["NaN"] } }],
      }),
    ).toThrow();
  });
});

function validateJson(schema: DescMessage, input: JsonValue) {
  validateMessage(schema, fromJson(schema, input));
}

test("an explicitly empty description fails even without an update mask", () => {
  expect(() =>
    validateJson(UpdateTaskRequestSchema, { task: { name: "tasks/one", description: "" } }),
  ).toThrow();
});
