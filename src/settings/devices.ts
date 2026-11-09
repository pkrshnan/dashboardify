// Devices that may call the API, each with its own token. Only a SHA-256 hash of the token is
// stored: the server never needs it back, so a copy of settings.db can't be used to sign in.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SettingsStore } from "./store";

SettingsStore.register("devices", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        token_hash BLOB NOT NULL UNIQUE,
        create_time TEXT NOT NULL,
        last_used_time TEXT
      )`);
    },
  },
]);

/** What sign-in needs: the device id for a bearer token, or undefined. */
export interface DeviceMatcher {
  match(token: string): string | undefined;
}

export interface Device {
  id: string;
  displayName: string;
  createTime: string;
  lastUsedTime?: string;
}

/** last_used_time is written at most this often per device. */
const LAST_USED_EVERY_MS = 60_000;

interface Row {
  id: string;
  display_name: string;
  create_time: string;
  last_used_time: string | null;
}

export class DeviceStore implements DeviceMatcher {
  private hashes: { id: string; hash: Buffer }[] = [];
  private loadedVersion = -1;
  private readonly lastWritten = new Map<string, number>();

  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Adds a device. Without a token, makes a new one; it is returned once and never stored. */
  add(displayName: string, token = newToken()): { device: Device; token: string } {
    const name = displayName.trim();
    if (!name) {
      throw new Error("A device needs a name");
    }
    const device = {
      id: this.freeId(slug(name)),
      displayName: name,
      createTime: this.now().toISOString(),
    };
    this.store.db
      .query("INSERT INTO devices (id, display_name, token_hash, create_time) VALUES (?, ?, ?, ?)")
      .run(device.id, device.displayName, hashToken(token), device.createTime);
    this.loadedVersion = -1;
    return { device, token };
  }

  list(): Device[] {
    return this.store.db
      .query<Row, []>(
        "SELECT id, display_name, create_time, last_used_time FROM devices ORDER BY create_time, id",
      )
      .all()
      .map((row) => ({
        id: row.id,
        displayName: row.display_name,
        createTime: row.create_time,
        lastUsedTime: row.last_used_time ?? undefined,
      }));
  }

  /** Deletes the device, so its token stops working on the next request. */
  revoke(id: string): boolean {
    const result = this.store.db.query("DELETE FROM devices WHERE id = ?").run(id);
    this.loadedVersion = -1;
    return result.changes > 0;
  }

  /** True if some device already has this token. */
  has(token: string): boolean {
    return this.find(hashToken(token)) !== undefined;
  }

  match(token: string): string | undefined {
    if (!token) {
      return undefined;
    }
    const id = this.find(hashToken(token));
    if (id) {
      this.touch(id);
    }
    return id;
  }

  /** Compares against every hash, so the time taken doesn't say which device matched. */
  private find(given: Buffer): string | undefined {
    let found: string | undefined;
    for (const { id, hash } of this.current()) {
      if (timingSafeEqual(hash, given)) {
        found = id;
      }
    }
    return found;
  }

  /** The hashes, reloaded when this store or another connection (the CLI) has written. */
  private current(): { id: string; hash: Buffer }[] {
    const version = this.store.version();
    if (version !== this.loadedVersion) {
      this.hashes = this.store.db
        .query<{ id: string; token_hash: Uint8Array }, []>("SELECT id, token_hash FROM devices")
        .all()
        .map((row) => ({ id: row.id, hash: Buffer.from(row.token_hash) }));
      this.loadedVersion = version;
    }
    return this.hashes;
  }

  private touch(id: string): void {
    const now = this.now();
    if (now.getTime() - (this.lastWritten.get(id) ?? 0) < LAST_USED_EVERY_MS) {
      return;
    }
    this.lastWritten.set(id, now.getTime());
    this.store.db
      .query("UPDATE devices SET last_used_time = ? WHERE id = ?")
      .run(now.toISOString(), id);
  }

  private freeId(base: string): string {
    const taken = new Set(this.list().map((device) => device.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) {
      id = `${base}-${n}`;
    }
    return id;
  }
}

/** 32 random bytes as base64url, with a prefix that secret scanners and logs can spot. */
export function newToken(): string {
  return `dfy_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** "Pranav's iPhone" → "pranavs-iphone". */
export function slug(name: string): string {
  const id = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "device";
}
