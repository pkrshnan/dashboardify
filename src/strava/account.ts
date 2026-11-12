// The one Strava account, in settings.db. The app's client secret and both tokens are sealed with
// the SecretBox (AAD "strava_account/strava/<field>") and only opened to talk to Strava.

import { SettingsStore } from "../settings/store";

SettingsStore.register("strava", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE strava_account (
        id TEXT PRIMARY KEY CHECK (id = 'strava'),
        athlete_id INTEGER NOT NULL,
        athlete_name TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret_sealed BLOB NOT NULL,
        refresh_token_sealed BLOB NOT NULL,
        access_token_sealed BLOB NOT NULL,
        access_expire_time TEXT NOT NULL,
        last_sync_time TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        status_detail TEXT,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL
      )`);
    },
  },
]);

const SEALED = ["client_secret_sealed", "refresh_token_sealed", "access_token_sealed"] as const;
SettingsStore.registerSealed("strava_account", "id", [...SEALED]);

const ID = "strava";

export type StravaStatus = "ok" | "auth_failed";

/** The account as it can be shown: no secrets. */
export interface StravaAccount {
  athleteId: number;
  athleteName: string;
  clientId: string;
  lastSyncTime?: string;
  status: StravaStatus;
  statusDetail?: string;
  createTime: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working. */
  expireTime: Date;
}

export interface Credentials extends Tokens {
  clientId: string;
  clientSecret: string;
}

interface Row {
  athlete_id: number;
  athlete_name: string;
  client_id: string;
  last_sync_time: string | null;
  status: StravaStatus;
  status_detail: string | null;
  create_time: string;
}

interface SealedRow {
  client_id: string;
  client_secret_sealed: Uint8Array;
  refresh_token_sealed: Uint8Array;
  access_token_sealed: Uint8Array;
  access_expire_time: string;
}

export class AlreadyConnected extends Error {}

export class StravaAccounts {
  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): StravaAccount | undefined {
    const row = this.store.db
      .query<Row, [string]>("SELECT * FROM strava_account WHERE id = ?")
      .get(ID);
    return row
      ? {
          athleteId: row.athlete_id,
          athleteName: row.athlete_name,
          clientId: row.client_id,
          lastSyncTime: row.last_sync_time ?? undefined,
          status: row.status,
          statusDetail: row.status_detail ?? undefined,
          createTime: row.create_time,
        }
      : undefined;
  }

  create(
    athlete: { id: number; name: string },
    app: { clientId: string; clientSecret: string },
    tokens: Tokens,
  ): StravaAccount {
    const time = this.now().toISOString();
    try {
      this.store.db
        .query(
          `INSERT INTO strava_account (id, athlete_id, athlete_name, client_id, client_secret_sealed,
            refresh_token_sealed, access_token_sealed, access_expire_time, create_time, update_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ID,
          athlete.id,
          athlete.name,
          app.clientId,
          this.seal("client_secret_sealed", app.clientSecret),
          this.seal("refresh_token_sealed", tokens.refreshToken),
          this.seal("access_token_sealed", tokens.accessToken),
          tokens.expireTime.toISOString(),
          time,
          time,
        );
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw new AlreadyConnected("Strava is already connected. Disconnect it first.");
      }
      throw error;
    }
    return this.get() as StravaAccount;
  }

  /** The app and tokens, opened for a request to Strava. */
  credentials(): Credentials | undefined {
    const row = this.store.db
      .query<SealedRow, [string]>("SELECT * FROM strava_account WHERE id = ?")
      .get(ID);
    if (!row) {
      return undefined;
    }
    return {
      clientId: row.client_id,
      clientSecret: this.open("client_secret_sealed", row.client_secret_sealed),
      refreshToken: this.open("refresh_token_sealed", row.refresh_token_sealed),
      accessToken: this.open("access_token_sealed", row.access_token_sealed),
      expireTime: new Date(row.access_expire_time),
    };
  }

  /**
   * Saves refreshed tokens. Strava may hand back a new refresh token, and the old one stops
   * working once the new one is used, so both are replaced together.
   */
  saveTokens(tokens: Tokens): void {
    this.store.db
      .query(
        "UPDATE strava_account SET refresh_token_sealed = ?, access_token_sealed = ?, access_expire_time = ?, status = 'ok', status_detail = NULL, update_time = ? WHERE id = ?",
      )
      .run(
        this.seal("refresh_token_sealed", tokens.refreshToken),
        this.seal("access_token_sealed", tokens.accessToken),
        tokens.expireTime.toISOString(),
        this.now().toISOString(),
        ID,
      );
  }

  /** A sync went through: the account works. */
  synced(): void {
    this.store.db
      .query(
        "UPDATE strava_account SET last_sync_time = ?, status = 'ok', status_detail = NULL WHERE id = ?",
      )
      .run(this.now().toISOString(), ID);
  }

  setStatus(status: StravaStatus, detail?: string): void {
    this.store.db
      .query("UPDATE strava_account SET status = ?, status_detail = ? WHERE id = ?")
      .run(status, detail ?? null, ID);
  }

  delete(): boolean {
    return this.store.db.query("DELETE FROM strava_account WHERE id = ?").run(ID).changes > 0;
  }

  private seal(field: (typeof SEALED)[number], value: string): Uint8Array {
    return this.store.box.seal(`strava_account/${ID}/${field}`, value);
  }

  private open(field: (typeof SEALED)[number], sealed: Uint8Array): string {
    return this.store.box.open(`strava_account/${ID}/${field}`, sealed);
  }
}
