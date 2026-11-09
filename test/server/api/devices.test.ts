import { beforeEach, describe, expect, test } from "bun:test";
import { SetupCode } from "../../../src/settings/setup-code";
import { useApi } from "./helpers";
import { expectNotInResponses } from "./secrets";

describe("devices API", () => {
  const api = useApi();

  test("create returns the token once, and it signs in", async () => {
    const { status, body } = await api.call("/v1/devices", "POST", {
      displayName: "Pranav's iPhone",
    });
    const signedIn = await api.call("/v1/devices", "GET", undefined, body.token);

    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "devices/pranavs-iphone", displayName: "Pranav's iPhone" });
    expect(body.token).toMatch(/^dfy_/);
    expect(signedIn.status).toBe(200);
  });

  test("list never includes a token", async () => {
    const created = await api.call("/v1/devices", "POST", { displayName: "Mac" });

    const listed = await api.call("/v1/devices");

    expect(listed.body.devices.map((d: { name: string }) => d.name)).toEqual([
      "devices/test",
      "devices/mac",
    ]);
    expectNotInResponses([listed.body], created.body.token);
  });

  test("marks the calling device as current", async () => {
    const { body } = await api.call("/v1/devices");

    expect(body.devices).toEqual([
      expect.objectContaining({ name: "devices/test", current: true }),
    ]);
  });

  test("a retry with the same request id adds one device", async () => {
    const request = { displayName: "Watch" };

    const first = await api.call("/v1/devices?requestId=r1", "POST", request);
    const again = await api.call("/v1/devices?requestId=r1", "POST", request);
    const listed = await api.call("/v1/devices");

    expect(again.body).toEqual(first.body);
    expect(listed.body.devices).toHaveLength(2);
  });

  test("delete revokes at once", async () => {
    const { body } = await api.call("/v1/devices", "POST", { displayName: "Old phone" });

    const deleted = await api.call("/v1/devices/old-phone", "DELETE");
    const after = await api.call("/v1/devices", "GET", undefined, body.token);
    const missing = await api.call("/v1/devices/old-phone", "DELETE");

    expect(deleted.status).toBe(200);
    expect(after.status).toBe(401);
    expect(missing.status).toBe(404);
  });

  test("a name is required", async () => {
    const { status } = await api.call("/v1/devices", "POST", { displayName: "  " });

    expect(status).toBe(400);
  });

  test("Connect serves the same service", async () => {
    const created = await api.call("/dashboardify.v1.DeviceService/CreateDevice", "POST", {
      device: { displayName: "Shortcut" },
      requestId: "c1",
    });
    const listed = await api.call("/dashboardify.v1.DeviceService/ListDevices", "POST", {});

    expect(created.body.token).toMatch(/^dfy_/);
    expect(listed.body.devices).toHaveLength(2);
    expectNotInResponses([listed.body], created.body.token);
  });
});

describe("the first-run setup code", () => {
  const setupCode = new SetupCode();
  const api = useApi({ setupCode });
  let code = "";

  beforeEach(() => {
    code = setupCode.issue();
  });

  test("adds one device, once", async () => {
    const created = await api.call("/v1/devices", "POST", { displayName: "Mac" }, code);
    const again = await api.call("/v1/devices", "POST", { displayName: "Mac" }, code);

    expect(created.status).toBe(200);
    expect(created.body.token).toMatch(/^dfy_/);
    expect(again.status).toBe(401);
    expect(again.body.setup).toBeUndefined();
  });

  test("can't do anything but add a device, and doesn't get used up trying", async () => {
    const home = await api.call("/v1/home", "GET", undefined, code);
    const list = await api.call("/v1/devices", "GET", undefined, code);
    const created = await api.call(
      "/dashboardify.v1.DeviceService/CreateDevice",
      "POST",
      { device: { displayName: "Phone" } },
      code,
    );

    expect(home.status).toBe(401);
    expect(list.status).toBe(401);
    expect(created.status).toBe(200);
  });

  test("while it waits, a 401 says so, for the sign-in screen", async () => {
    const { status, body } = await api.call("/v1/home", "GET", undefined, "wrong");

    expect(status).toBe(401);
    expect(body).toEqual({ error: "unauthorized", setup: true });
  });
});
