import { describe, expect, test } from "bun:test";
import { createECDH } from "node:crypto";
import { join } from "node:path";
import { subscriptionId } from "../../../src/notifications/push-store";
import { useApi } from "./helpers";
import { expectNotInResponses } from "./secrets";

function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.from("0123456789abcdef").toString("base64url"),
  };
}

const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMH-abc";

describe("notification settings API", () => {
  const api = useApi();

  test("starts at 60 and 10 minutes, tasks on, with a public key that stays the same", async () => {
    const first = await api.call("/v1/notificationSettings");
    const again = await api.call("/v1/notificationSettings");

    expect(first.body).toMatchObject({
      name: "notificationSettings",
      eventOffsetMinutes: [60, 10],
      taskReminders: true,
    });
    expect(Buffer.from(first.body.publicKey, "base64url")).toHaveLength(65);
    expect(again.body.publicKey).toBe(first.body.publicKey);
  });

  test("changes only the masked fields, keeping offsets largest first", async () => {
    const offsets = await api.call("/v1/notificationSettings", "PATCH", {
      eventOffsetMinutes: [5, 30],
    });
    const tasks = await api.call("/v1/notificationSettings?updateMask=taskReminders", "PATCH", {
      taskReminders: false,
      eventOffsetMinutes: [1],
    });

    expect(offsets.body).toMatchObject({ eventOffsetMinutes: [30, 5], taskReminders: true });
    expect(tasks.body).toMatchObject({ eventOffsetMinutes: [30, 5], taskReminders: false });
  });

  test("empty offsets turn event reminders off", async () => {
    const { status, body } = await api.call(
      "/v1/notificationSettings?updateMask=eventOffsetMinutes",
      "PATCH",
      {},
    );
    const read = await api.call("/v1/notificationSettings");

    expect(status).toBe(200);
    expect(body.eventOffsetMinutes ?? []).toEqual([]);
    expect(read.body).toMatchObject({ taskReminders: true });
    expect(read.body.eventOffsetMinutes ?? []).toEqual([]);
  });

  test("refuses offsets out of range, repeated or more than three", async () => {
    for (const eventOffsetMinutes of [[0], [1441], [10, 10], [1, 2, 3, 4]]) {
      const { status } = await api.call("/v1/notificationSettings", "PATCH", {
        eventOffsetMinutes,
      });

      expect(status).toBe(400);
    }
  });
});

describe("push subscriptions API", () => {
  const pushed: Request[] = [];
  let answer = 201;
  const api = useApi({
    push: (request) => {
      pushed.push(request);
      return new Response(null, { status: answer });
    },
  });

  async function subscribe(endpoint = ENDPOINT, token = "secret") {
    return api.call(
      "/v1/pushSubscriptions",
      "POST",
      { endpoint, ...browserKeys(), displayName: "iPhone" },
      token,
    );
  }

  test("adds this browser, named from its endpoint, and never returns the endpoint or keys", async () => {
    const keys = browserKeys();

    const created = await api.call("/v1/pushSubscriptions", "POST", {
      endpoint: ENDPOINT,
      ...keys,
      displayName: "iPhone",
    });
    const listed = await api.call("/v1/pushSubscriptions");

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: `pushSubscriptions/${subscriptionId(ENDPOINT)}`,
      displayName: "iPhone",
      device: "devices/test",
    });
    expect(listed.body.pushSubscriptions).toEqual([created.body]);
    for (const secret of [ENDPOINT, keys.p256dh, keys.auth]) {
      expectNotInResponses([created.body, listed.body], secret);
    }
  });

  test("keeps the endpoint and keys sealed in settings.db", async () => {
    const keys = browserKeys();
    await api.call("/v1/pushSubscriptions", "POST", { endpoint: ENDPOINT, ...keys });

    const file = Buffer.from(await Bun.file(join(api.dir, "data/settings.db")).arrayBuffer());

    expect(file.includes(Buffer.from(ENDPOINT))).toBe(false);
    expect(file.includes(Buffer.from(keys.auth))).toBe(false);
  });

  test("the same endpoint again replaces its keys and keeps one row", async () => {
    const first = await subscribe();
    const again = await subscribe();
    const listed = await api.call("/v1/pushSubscriptions");

    expect(again.body).toEqual(first.body);
    expect(listed.body.pushSubscriptions).toHaveLength(1);
  });

  test("refuses endpoints that aren't a known push service", async () => {
    for (const endpoint of [
      "http://web.push.apple.com/abc",
      "https://192.168.1.10/push",
      "https://push.apple.com.evil.example/abc",
    ]) {
      const { status } = await subscribe(endpoint);

      expect(status).toBe(400);
    }
  });

  test("delete stops reminders to that browser", async () => {
    const { body } = await subscribe();

    const deleted = await api.call(`/v1/${body.name}`, "DELETE");
    const again = await api.call(`/v1/${body.name}`, "DELETE");
    const listed = await api.call("/v1/pushSubscriptions");

    expect(deleted.status).toBe(200);
    expect(again.status).toBe(404);
    expect(listed.body.pushSubscriptions ?? []).toEqual([]);
  });

  test("revoking a device drops its browsers", async () => {
    const phone = await api.call("/v1/devices", "POST", { displayName: "Phone" });
    await subscribe("https://web.push.apple.com/phone", phone.body.token);
    await subscribe("https://fcm.googleapis.com/fcm/send/desk");

    await api.call("/v1/devices/phone", "DELETE");
    const listed = await api.call("/v1/pushSubscriptions");

    expect(listed.body.pushSubscriptions.map((s: { device: string }) => s.device)).toEqual([
      "devices/test",
    ]);
  });

  test("a test goes to the calling device's browsers only", async () => {
    pushed.length = 0;
    answer = 201;
    const phone = await api.call("/v1/devices", "POST", { displayName: "Phone" });
    await subscribe("https://web.push.apple.com/phone", phone.body.token);
    await subscribe();

    const { status, body } = await api.call("/v1/pushSubscriptions:test", "POST", {});

    expect(status).toBe(200);
    expect(body).toEqual({ sent: 1 });
    expect(pushed.map((r) => r.url)).toEqual([ENDPOINT]);
    expect(pushed[0]?.headers.get("authorization")).toStartWith("vapid t=");
  });

  test("a browser the push service says is gone is dropped", async () => {
    answer = 410;
    await subscribe();

    const { body } = await api.call("/v1/pushSubscriptions:test", "POST", {});
    const listed = await api.call("/v1/pushSubscriptions");

    expect(body).toEqual({ failed: 1 });
    expect(listed.body.pushSubscriptions ?? []).toEqual([]);
  });

  test("a test with no browsers asks you to turn notifications on", async () => {
    const { status, body } = await api.call("/v1/pushSubscriptions:test", "POST", {});

    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("Turn notifications on");
  });
});
