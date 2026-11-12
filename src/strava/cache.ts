// strava-cache.db: your Strava runs as the list endpoint last described them. Derived and
// disposable: deleting the file makes the next sync fetch the last 90 days again.

import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Bump when the table changes; an older file is dropped and refilled by the next sync. */
const SCHEMA_VERSION = 1;

export interface Run {
  id: number;
  athleteId: number;
  name: string;
  sportType: string;
  /** Start, UTC milliseconds. */
  start: number;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
}

interface Row {
  id: number;
  athlete_id: number;
  name: string;
  sport_type: string;
  start_ms: number;
  elapsed_s: number;
  moving_s: number;
  distance_m: number;
}

export class RunCache {
  private constructor(private readonly db: Database) {}

  static async open(dataPath: string): Promise<RunCache> {
    await mkdir(dataPath, { recursive: true, mode: 0o700 });
    const path = join(dataPath, "strava-cache.db");
    const db = new Database(path, { create: true, strict: true });
    await chmod(path, 0o600);
    db.run("PRAGMA journal_mode = WAL");
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    if (version?.user_version !== SCHEMA_VERSION) {
      db.run("DROP TABLE IF EXISTS runs");
      db.run(`CREATE TABLE runs (
        id INTEGER PRIMARY KEY,
        athlete_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sport_type TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        elapsed_s INTEGER NOT NULL,
        moving_s INTEGER NOT NULL,
        distance_m REAL NOT NULL
      )`);
      db.run("CREATE INDEX runs_start ON runs (start_ms)");
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    return new RunCache(db);
  }

  close(): void {
    this.db.close();
  }

  /** Runs that start in [from, to), oldest first. */
  between(from: number, to: number): Run[] {
    return this.db
      .query<Row, [number, number]>(
        "SELECT * FROM runs WHERE start_ms >= ? AND start_ms < ? ORDER BY start_ms",
      )
      .all(from, to)
      .map(toRun);
  }

  /** The newest run's start, if any. */
  newest(): number | undefined {
    const row = this.db
      .query<{ start: number | null }, []>("SELECT MAX(start_ms) AS start FROM runs")
      .get();
    return row?.start ?? undefined;
  }

  /**
   * Makes the cache say exactly `runs` for starts from `from` on, and returns every run added,
   * changed or removed, in both its old and new form.
   */
  replaceFrom(from: number, runs: Run[]): Run[] {
    const before = new Map(this.between(from, Number.MAX_SAFE_INTEGER).map((r) => [r.id, r]));
    const put = runs.filter((run) => {
      const old = before.get(run.id);
      return !(old && same(old, run));
    });
    const gone = [...before.values()].filter((old) => !runs.some((run) => run.id === old.id));
    this.db.transaction(() => {
      for (const run of put) {
        this.put(run);
      }
      for (const run of gone) {
        this.db.query("DELETE FROM runs WHERE id = ?").run(run.id);
      }
    })();
    const replaced = put.flatMap((run) => before.get(run.id) ?? []);
    return [...replaced, ...put, ...gone];
  }

  /** Forgets every run not by this athlete (all of them when none); returns what went. */
  keepOnly(athleteId: number | undefined): Run[] {
    const gone = this.db
      .query<Row, [number]>("SELECT * FROM runs WHERE athlete_id != ?")
      .all(athleteId ?? -1)
      .map(toRun);
    this.db.query("DELETE FROM runs WHERE athlete_id != ?").run(athleteId ?? -1);
    return gone;
  }

  private put(run: Run): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO runs (id, athlete_id, name, sport_type, start_ms, elapsed_s,
          moving_s, distance_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.athleteId,
        run.name,
        run.sportType,
        run.start,
        run.elapsedSeconds,
        run.movingSeconds,
        run.distanceMeters,
      );
  }
}

function same(a: Run, b: Run): boolean {
  return (Object.keys(a) as (keyof Run)[]).every((key) => a[key] === b[key]);
}

function toRun(row: Row): Run {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    name: row.name,
    sportType: row.sport_type,
    start: row.start_ms,
    elapsedSeconds: row.elapsed_s,
    movingSeconds: row.moving_s,
    distanceMeters: row.distance_m,
  };
}
