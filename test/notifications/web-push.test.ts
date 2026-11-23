import { describe, expect, test } from "bun:test";
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import {
  encrypt,
  generateKeys,
  type Subscription,
  send,
  vapidAuthorization,
} from "../../src/notifications/web-push";

// RFC 8291 appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  serverPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  browserPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  browserPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** A browser: its key pair, and how it would read a push. */
function browser(): Subscription & { decrypt: (body: Uint8Array) => string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  return {
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH",
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
    decrypt: (body) => decrypt(Buffer.from(body), ecdh, auth),
  };
}

/** RFC 8291 from the browser's side, written separately from the code under test. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const serverPublic = body.subarray(21, 21 + keyLength);
  const record = body.subarray(21 + keyLength);
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const expand = (prk: Buffer, info: string | Buffer, n: number) =>
    hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, n);
  const shared = ecdh.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverPublic]);
  const ikm = expand(hmac(auth, shared), info, 32);
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    expand(prk, "Content-Encoding: aes128gcm\0", 16),
    expand(prk, "Content-Encoding: nonce\0", 12),
  );
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  expect(padded.at(-1)).toBe(0x02);
  return padded.subarray(0, -1).toString();
}

describe("encrypt", () => {
  test("matches RFC 8291's example byte for byte", () => {
    const body = encrypt(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.browserPublic, auth: RFC.auth },
      { privateKey: RFC.serverPrivate, salt: Buffer.from(RFC.salt, "base64url") },
    );

    expect(Buffer.from(body).toString("base64url")).toBe(RFC.body);
  });

  test("the browser can read it, and each push uses a new key and salt", () => {
    const b = browser();
    const plaintext = new TextEncoder().encode('{"title":"Standup"}');

    const first = encrypt(plaintext, b);
    const second = encrypt(plaintext, b);

    expect(b.decrypt(first)).toBe('{"title":"Standup"}');
    expect(Buffer.from(first).subarray(0, 16)).not.toEqual(Buffer.from(second).subarray(0, 16));
  });
});

describe("vapidAuthorization", () => {
  const keys = generateKeys();
  const now = () => new Date("2026-11-22T09:00:00Z");

  test("signs a JWT for the endpoint's origin that our public key verifies", () => {
    const header = vapidAuthorization("https://web.push.apple.com/abc?x=1", {
      keys,
      subject: "https://dash.example.ts.net",
      now,
    });

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head = "", claims = "", signature = "", k = ""] = match ?? [];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: Date.parse("2026-11-22T21:00:00Z") / 1000,
      sub: "https://dash.example.ts.net",
    });
    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: pub.subarray(1, 33).toString("base64url"),
        y: pub.subarray(33).toString("base64url"),
      },
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${head}.${claims}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });
});

describe("send", () => {
  const keys = generateKeys();
  const options = { keys, subject: "https://dash.example.ts.net", ttl: 600 };

  test("posts the encrypted payload with the push headers", async () => {
    const b = browser();
    let seen: Request | undefined;

    const result = await send(b, "hello", {
      ...options,
      urgency: "high",
      fetch: (request) => {
        seen = request;
        return Promise.resolve(new Response(null, { status: 201 }));
      },
    });

    expect(result).toEqual({ status: "sent" });
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe(b.endpoint);
    expect(seen?.headers.get("ttl")).toBe("600");
    expect(seen?.headers.get("urgency")).toBe("high");
    expect(seen?.headers.get("content-encoding")).toBe("aes128gcm");
    expect(seen?.headers.get("authorization")).toStartWith("vapid t=");
    expect(b.decrypt(new Uint8Array(await (seen as Request).arrayBuffer()))).toBe("hello");
  });

  test("404 and 410 mean the subscription is gone", async () => {
    for (const status of [404, 410]) {
      const result = await send(browser(), "x", {
        ...options,
        fetch: () => Promise.resolve(new Response(null, { status })),
      });

      expect(result).toEqual({ status: "gone" });
    }
  });

  test("other errors fail without throwing", async () => {
    const rejected = await send(browser(), "x", {
      ...options,
      fetch: () => Promise.resolve(new Response("BadJwtToken", { status: 403 })),
    });
    const offline = await send(browser(), "x", {
      ...options,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });

    expect(rejected).toEqual({ status: "failed", code: 403, detail: "BadJwtToken" });
    expect(offline).toMatchObject({ status: "failed", code: 0 });
  });
});
