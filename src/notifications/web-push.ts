// Web Push from the server to a browser's push service (Apple's for an iPhone). Two RFCs cover it:
// RFC 8292 (VAPID) signs each request with our key pair, so the push service knows it came from
// the server the browser subscribed to; RFC 8291 encrypts the payload for the browser alone, so
// the push service sees only its size. Written on node:crypto rather than a dependency; the
// tests check it against RFC 8291's worked example.

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

/** A P-256 key pair, both halves base64url: the public key uncompressed (65 bytes), the private 32. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** What `PushManager.subscribe()` gave the browser, as its `toJSON()` spells it. */
export interface Subscription {
  endpoint: string;
  /** The browser's P-256 public key, base64url. */
  p256dh: string;
  /** A 16-byte secret shared with the browser, base64url. */
  auth: string;
}

export interface SendOptions {
  keys: VapidKeys;
  /** Who to contact about our pushes: an https: or mailto: address. Apple rejects localhost. */
  subject: string;
  /** Seconds the push service keeps it while the device is offline. */
  ttl: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  fetch?: (request: Request) => Promise<Response>;
  now?: () => Date;
}

/** `gone` means the browser dropped the subscription: delete it. */
export type SendResult =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "failed"; code: number; detail: string };

/** One record, so payloads stay well under the 4 KB that push services accept. */
const RECORD_SIZE = 4096;
/** VAPID tokens may live up to a day; half that leaves room for clock drift. */
const TOKEN_LIFETIME_S = 12 * 3600;

export function generateKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

/** Posts one push. Errors from the network are a failure, never a throw. */
export async function send(
  subscription: Subscription,
  payload: string,
  options: SendOptions,
): Promise<SendResult> {
  const body = encrypt(new TextEncoder().encode(payload), subscription);
  const request = new Request(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: vapidAuthorization(subscription.endpoint, options),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(Math.max(0, Math.round(options.ttl))),
      urgency: options.urgency ?? "normal",
    },
    body,
  });
  try {
    const response = await (options.fetch ?? fetch)(request);
    return await readResult(response);
  } catch (error) {
    return { status: "failed", code: 0, detail: String(error) };
  }
}

async function readResult(response: Response): Promise<SendResult> {
  if (response.ok) {
    return { status: "sent" };
  }
  if (response.status === 404 || response.status === 410) {
    return { status: "gone" };
  }
  const detail = (await response.text().catch(() => "")).slice(0, 200);
  return { status: "failed", code: response.status, detail };
}

/** `vapid t=<JWT>, k=<public key>` (RFC 8292 section 3), for the endpoint's origin. */
export function vapidAuthorization(
  endpoint: string,
  options: Pick<SendOptions, "keys" | "subject" | "now">,
): string {
  const now = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: new URL(endpoint).origin,
    exp: now + TOKEN_LIFETIME_S,
    sub: options.subject,
  };
  const unsigned = `${base64Json(header)}.${base64Json(claims)}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKeyObject(options.keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${options.keys.publicKey}`;
}

function base64Json(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function privateKeyObject(keys: VapidKeys) {
  const pub = Buffer.from(keys.publicKey, "base64url");
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
  });
}

/** Fixed inputs for the RFC's example; real sends use a fresh key and salt each time. */
export interface EncryptInputs {
  /** Our one-off private key, base64url. */
  privateKey?: string;
  salt?: Uint8Array;
}

/**
 * The `aes128gcm` body (RFC 8291 section 4, RFC 8188): salt, record size, our one-off public
 * key, then one encrypted record ending in the last-record delimiter.
 */
export function encrypt(
  plaintext: Uint8Array,
  subscription: Pick<Subscription, "p256dh" | "auth">,
  inputs: EncryptInputs = {},
): Uint8Array<ArrayBuffer> {
  const ecdh = createECDH("prime256v1");
  if (inputs.privateKey) {
    ecdh.setPrivateKey(Buffer.from(inputs.privateKey, "base64url"));
  } else {
    ecdh.generateKeys();
  }
  const salt = inputs.salt ?? randomBytes(16);
  const { key, nonce } = deriveKeys(ecdh, subscription, salt);

  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const serverPublic = ecdh.getPublicKey();
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, record]);
}

function deriveKeys(
  ecdh: ReturnType<typeof createECDH>,
  subscription: Pick<Subscription, "p256dh" | "auth">,
  salt: Uint8Array,
): { key: Buffer; nonce: Buffer } {
  const browserPublic = Buffer.from(subscription.p256dh, "base64url");
  const shared = ecdh.computeSecret(browserPublic);
  // The browser's auth secret and both public keys go into the key, so it is for this pair alone.
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    browserPublic,
    ecdh.getPublicKey(),
  ]);
  const ikm = hkdf(Buffer.from(subscription.auth, "base64url"), shared, keyInfo, 32);
  return {
    key: hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
    nonce: hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12),
  };
}

/** HKDF-SHA-256 for outputs of at most 32 bytes: one expand step. */
function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}
