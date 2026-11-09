import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { OpenError, SecretBox } from "../../src/settings/secret-box";

const box = new SecretBox(randomBytes(32));
const aad = "calendar_accounts/icloud/password";

describe("SecretBox", () => {
  test("opens what it sealed", () => {
    expect(box.open(aad, box.seal(aad, "abcd-efgh-ijkl-mnop"))).toBe("abcd-efgh-ijkl-mnop");
  });

  test("starts with version 1 and a 12-byte nonce, and hides the text", () => {
    const sealed = box.seal(aad, "secret");

    expect(sealed[0]).toBe(0x01);
    expect(sealed.length).toBe(1 + 12 + "secret".length + 16);
    expect(Buffer.from(sealed).includes(Buffer.from("secret"))).toBe(false);
  });

  test("two seals of one value differ", () => {
    expect(box.seal(aad, "same")).not.toEqual(box.seal(aad, "same"));
  });

  test("won't open with another row's or field's AAD", () => {
    const sealed = box.seal(aad, "secret");

    expect(() => box.open("calendar_accounts/work/password", sealed)).toThrow(OpenError);
    expect(() => box.open("calendar_accounts/icloud/feed_url", sealed)).toThrow(OpenError);
  });

  test("won't open a changed byte, an unknown version or a short value", () => {
    const sealed = box.seal(aad, "secret");
    const flipped = Uint8Array.from(sealed);
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    const version = Uint8Array.from(sealed);
    version[0] = 0x02;

    expect(() => box.open(aad, flipped)).toThrow(OpenError);
    expect(() => box.open(aad, version)).toThrow(OpenError);
    expect(() => box.open(aad, sealed.subarray(0, 10))).toThrow(OpenError);
  });

  test("won't open with another key", () => {
    const other = new SecretBox(randomBytes(32));

    expect(() => other.open(aad, box.seal(aad, "secret"))).toThrow(OpenError);
  });

  test("needs a 32-byte key", () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
  });
});
