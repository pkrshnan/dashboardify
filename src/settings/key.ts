// The 32-byte key that seals secrets in settings.db. It lives in its own file, outside the
// database and the backup, so a copy of the database alone can't be opened.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const KEY_BYTES = 32;

export interface KeyOptions {
  dataPath: string;
  /** SECRET_KEY_FILE: a Docker or systemd secret to use instead of $DATA_PATH/secret.key. */
  keyFile?: string;
}

export class KeyError extends Error {}

/**
 * The key from SECRET_KEY_FILE or $DATA_PATH/secret.key, made on first run with mode 0600. The
 * file holds either the 32 raw bytes or them as one line of base64, as `settings key show`
 * prints them for a password manager.
 */
export async function loadKey(options: KeyOptions): Promise<Uint8Array> {
  const path = options.keyFile ?? join(options.dataPath, "secret.key");
  const file = Bun.file(path);
  if (await file.exists()) {
    return decodeKey(new Uint8Array(await file.arrayBuffer()), path);
  }
  if (options.keyFile) {
    throw new KeyError(`SECRET_KEY_FILE ${path} doesn't exist`);
  }
  if (await exists(join(options.dataPath, "settings.db"))) {
    // A new key couldn't open the secrets already sealed in the database.
    throw new KeyError(
      `${path} is missing but settings.db exists. Restore the key from your password manager.`,
    );
  }
  await mkdir(options.dataPath, { recursive: true, mode: 0o700 });
  const key = new Uint8Array(randomBytes(KEY_BYTES));
  await Bun.write(path, key);
  await chmod(path, 0o600);
  return key;
}

function decodeKey(bytes: Uint8Array, path: string): Uint8Array {
  if (bytes.length === KEY_BYTES) {
    return bytes;
  }
  const text = new TextDecoder().decode(bytes).trim();
  const decoded = /^[A-Za-z0-9+/_-]+=*$/.test(text) ? Buffer.from(text, "base64") : undefined;
  if (decoded?.length === KEY_BYTES) {
    return new Uint8Array(decoded);
  }
  throw new KeyError(`${path} must hold ${KEY_BYTES} bytes, raw or as base64`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
