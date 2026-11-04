import { describe, expect, test } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { GetHomeRequestSchema, HomeSchema } from "../../../src/gen/dashboardify/v1/home_pb";
import { useApi } from "./helpers";

describe("protobuf transports", () => {
  const api = useApi();

  test("Connect accepts binary protobuf requests", async () => {
    const response = await api.app.request("/dashboardify.v1.HomeService/GetHome", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/proto",
        "connect-protocol-version": "1",
      },
      body: toBinary(GetHomeRequestSchema, create(GetHomeRequestSchema, { name: "home" })),
    });

    expect(response.status).toBe(200);
    expect(fromBinary(HomeSchema, new Uint8Array(await response.arrayBuffer())).name).toBe("home");
  });

  test("requires authentication", async () => {
    const response = await api.app.request("/v1/home");

    expect(response.status).toBe(401);
  });
});

describe("shared request validation", () => {
  const api = useApi();

  test("both JSON transports reject a missing required task payload", async () => {
    const rest = await api.call("/v1/tasks", "POST", {});
    const connect = await api.call("/dashboardify.v1.TaskService/CreateTask", "POST", {});
    const listed = await api.call("/v1/tasks");

    expect(rest.status).toBe(400);
    expect(connect.status).toBe(400);
    expect(listed.body.tasks ?? []).toEqual([]);
  });

  test("checks protobuf scalar types and path-body name agreement", async () => {
    const badType = await api.call("/v1/days/2026-11-03/checkin", "PATCH", { feel: "bad" });
    const badName = await api.call("/v1/days/2026-11-03/checkin", "PATCH", {
      name: "days/2026-11-04/checkin",
      feel: 3,
    });

    expect(badType.status).toBe(400);
    expect(badName.status).toBe(400);
  });
});
