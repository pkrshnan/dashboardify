import { expect, test } from "bun:test";
import { name } from "../src/main";

test("toolchain runs", () => {
  expect(name).toBe("dashboardify");
});
