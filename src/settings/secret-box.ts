// Seals secrets for settings.db with AES-256-GCM. Each value gets a random nonce, and the
// additional data names where it is stored ("calendar_accounts/icloud/password"), so a sealed
// value copied into another row or field won't open.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KEY_BYTES } from "./key";

const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Wrong key, wrong place, changed bytes or an unknown format: one error, no detail. */
export class OpenError extends Error {
  constructor() {
    super("Can't open the sealed value");
  }
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`The key must be ${KEY_BYTES} bytes`);
    }
    this.key = Buffer.from(key);
  }

  /** Version byte 0x01, a 12-byte nonce, then the ciphertext and its 16-byte tag. */
  seal(aad: string, plaintext: string): Uint8Array {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return new Uint8Array(Buffer.concat([Buffer.of(VERSION), nonce, body, cipher.getAuthTag()]));
  }

  open(aad: string, sealed: Uint8Array): string {
    const bytes = Buffer.from(sealed);
    if (bytes.length < 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== VERSION) {
      throw new OpenError();
    }
    const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
    const body = bytes.subarray(1 + NONCE_BYTES, bytes.length - TAG_BYTES);
    const tag = bytes.subarray(bytes.length - TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      throw new OpenError();
    }
  }
}
