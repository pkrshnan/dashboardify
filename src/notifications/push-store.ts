// Web Push state in settings.db: the server's VAPID key pair, the browsers that get reminders,
// and when reminders go. A subscription's endpoint and keys are sealed like any other secret:
// with them, and our private key, anyone could push to the phone.

import { createHash } from "node:crypto";
import "../settings/devices";
import { SettingsStore } from "../settings/store";
import { generateKeys, type Subscription, type VapidKeys } from "./web-push";

SettingsStore.register("notifications", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE push_keys (
        id TEXT PRIMARY KEY CHECK (id = 'vapid'),
        public_key TEXT NOT NULL,
        private_key_sealed BLOB NOT NULL,
        create_time TEXT NOT NULL
      )`);
      // A device's subscriptions go when it is revoked. Tailnet sign-ins have no row to follow.
      db.run(`CREATE TABLE push_subscriptions (
        id TEXT PRIMARY KEY,
        device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
        tailnet_login TEXT,
        endpoint_sealed BLOB NOT NULL,
        keys_sealed BLOB NOT NULL,
        display_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        create_time TEXT NOT NULL,
        CHECK ((device_id IS NULL) <> (tailnet_login IS NULL))
      )`);
      db.run(`CREATE TABLE notification_settings (
        id TEXT PRIMARY KEY CHECK (id = 'notifications'),
        event_offsets TEXT NOT NULL,
        task_reminders INTEGER NOT NULL,
        update_time TEXT NOT NULL
      )`);
      db.run("INSERT INTO notification_settings VALUES ('notifications', '[60,10]', 1, ?)", [
        new Date().toISOString(),
      ]);
    },
  },
  {
    version: 2,
    up: (db) => {
      // Reminders already sent, so a restart doesn't send them again. Pruned after two days.
      db.run("CREATE TABLE sent_reminders (key TEXT PRIMARY KEY, sent_time TEXT NOT NULL)");
    },
  },
]);

SettingsStore.registerSealed("push_keys", "id", ["private_key_sealed"]);
SettingsStore.registerSealed("push_subscriptions", "id", ["endpoint_sealed", "keys_sealed"]);

/**
 * Push services we post to. Anything else is refused, so a signed-in device can't point the
 * server at an address on the home network.
 */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export interface NotificationPrefs {
  /** Minutes before a timed event, largest first. */
  eventOffsets: number[];
  taskReminders: boolean;
}

/** A subscription as it can be shown: no endpoint or keys. */
export interface StoredSubscription {
  id: string;
  /** `devices/<id>` or `tailnet:<login>`. */
  device: string;
  displayName: string;
  createTime: string;
}

/** What sending needs. */
export interface Target extends StoredSubscription, Subscription {
  /** VAPID `sub`: the address the browser subscribed from. */
  subject: string;
}

export class UnknownPushService extends Error {}

interface Row {
  id: string;
  device_id: string | null;
  tailnet_login: string | null;
  display_name: string;
  create_time: string;
}

interface SealedRow extends Row {
  endpoint_sealed: Uint8Array;
  keys_sealed: Uint8Array;
  subject: string;
}

export class PushStore {
  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The VAPID pair, made on first use. */
  keys(): VapidKeys {
    const row = this.store.db
      .query<{ public_key: string; private_key_sealed: Uint8Array }, []>(
        "SELECT public_key, private_key_sealed FROM push_keys WHERE id = 'vapid'",
      )
      .get();
    if (row) {
      return {
        publicKey: row.public_key,
        privateKey: this.store.box.open(KEY_AAD, row.private_key_sealed),
      };
    }
    const keys = generateKeys();
    this.store.db
      .query("INSERT INTO push_keys VALUES ('vapid', ?, ?, ?)")
      .run(keys.publicKey, this.store.box.seal(KEY_AAD, keys.privateKey), this.now().toISOString());
    return keys;
  }

  prefs(): NotificationPrefs {
    const row = this.store.db
      .query<{ event_offsets: string; task_reminders: number }, []>(
        "SELECT event_offsets, task_reminders FROM notification_settings",
      )
      .get();
    return {
      eventOffsets: row ? (JSON.parse(row.event_offsets) as number[]) : [],
      taskReminders: row?.task_reminders === 1,
    };
  }

  setPrefs(prefs: NotificationPrefs): NotificationPrefs {
    const offsets = [...new Set(prefs.eventOffsets)].sort((a, b) => b - a);
    this.store.db
      .query(
        "UPDATE notification_settings SET event_offsets = ?, task_reminders = ?, update_time = ?",
      )
      .run(JSON.stringify(offsets), prefs.taskReminders ? 1 : 0, this.now().toISOString());
    return this.prefs();
  }

  /**
   * Adds a browser for `device`. The same endpoint again replaces the old row, keeping its
   * create time, since browsers resubscribe with new keys.
   */
  subscribe(
    /** The sign-in: a device id, or `tailnet:<login>`. */
    device: string,
    subscription: Subscription & { displayName: string; subject: string },
  ): StoredSubscription {
    checkEndpoint(subscription.endpoint);
    const id = subscriptionId(subscription.endpoint);
    const owner = ownerColumns(device);
    const created =
      this.store.db
        .query<{ create_time: string }, [string]>(
          "SELECT create_time FROM push_subscriptions WHERE id = ?",
        )
        .get(id)?.create_time ?? this.now().toISOString();
    const keys = JSON.stringify({ p256dh: subscription.p256dh, auth: subscription.auth });
    this.store.db
      .query(
        `INSERT OR REPLACE INTO push_subscriptions (id, device_id, tailnet_login, endpoint_sealed,
          keys_sealed, display_name, subject, create_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        owner.deviceId,
        owner.tailnetLogin,
        this.seal(id, "endpoint_sealed", subscription.endpoint),
        this.seal(id, "keys_sealed", keys),
        subscription.displayName.trim(),
        subscription.subject,
        created,
      );
    return {
      id,
      device: deviceName(device),
      displayName: subscription.displayName.trim(),
      createTime: created,
    };
  }

  list(): StoredSubscription[] {
    return this.rows().map(view);
  }

  /** Every subscription with what sending needs, or only those added by one sign-in. */
  targets(signedIn?: string): Target[] {
    const device = signedIn === undefined ? undefined : deviceName(signedIn);
    return this.rows()
      .map((row) => ({ ...view(row), ...this.openRow(row) }))
      .filter((target) => device === undefined || target.device === device);
  }

  wasSent(key: string): boolean {
    return this.store.db.query("SELECT 1 FROM sent_reminders WHERE key = ?").get(key) !== null;
  }

  /** Logs a reminder as sent, and forgets ones older than two days. */
  markSent(key: string): void {
    const now = this.now();
    this.store.db
      .query("INSERT OR REPLACE INTO sent_reminders VALUES (?, ?)")
      .run(key, now.toISOString());
    this.store.db
      .query("DELETE FROM sent_reminders WHERE sent_time < ?")
      .run(new Date(now.getTime() - SENT_KEPT_MS).toISOString());
  }

  remove(id: string): boolean {
    return this.store.db.query("DELETE FROM push_subscriptions WHERE id = ?").run(id).changes > 0;
  }

  private rows(): SealedRow[] {
    return this.store.db
      .query<SealedRow, []>("SELECT * FROM push_subscriptions ORDER BY create_time, rowid")
      .all();
  }

  private openRow(row: SealedRow): Subscription & { subject: string } {
    const keys = JSON.parse(this.open(row.id, "keys_sealed", row.keys_sealed)) as {
      p256dh: string;
      auth: string;
    };
    return {
      endpoint: this.open(row.id, "endpoint_sealed", row.endpoint_sealed),
      p256dh: keys.p256dh,
      auth: keys.auth,
      subject: row.subject,
    };
  }

  private seal(id: string, field: string, value: string): Uint8Array {
    return this.store.box.seal(`push_subscriptions/${id}/${field}`, value);
  }

  private open(id: string, field: string, sealed: Uint8Array): string {
    return this.store.box.open(`push_subscriptions/${id}/${field}`, sealed);
  }
}

const KEY_AAD = "push_keys/vapid/private_key_sealed";
/** Longer than any reminder's window, so an entry is gone only once it can't fire again. */
const SENT_KEPT_MS = 2 * 86_400_000;

/** The first 16 hex digits of the endpoint's SHA-256; the web app works it out the same way. */
export function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

function checkEndpoint(endpoint: string): void {
  const url = URL.parse(endpoint);
  if (!(url && url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname)))) {
    throw new UnknownPushService(`${url?.hostname ?? "That"} isn't a known push service`);
  }
}

/** A sign-in as the API names it: `devices/<id>`, or `tailnet:<login>` as it is. */
function deviceName(signedIn: string): string {
  return signedIn.startsWith("tailnet:") ? signedIn : `devices/${signedIn}`;
}

function ownerColumns(device: string): { deviceId: string | null; tailnetLogin: string | null } {
  if (device.startsWith("tailnet:")) {
    return { deviceId: null, tailnetLogin: device.slice("tailnet:".length) };
  }
  return { deviceId: device, tailnetLogin: null };
}

function view(row: Row): StoredSubscription {
  return {
    id: row.id,
    device: row.device_id ? `devices/${row.device_id}` : `tailnet:${row.tailnet_login}`,
    displayName: row.display_name,
    createTime: row.create_time,
  };
}
