import { describe, expect, test } from "bun:test";
import { LAG_MS, lag, nextSync, shortDuration } from "../../src/health/sync";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const MINUTE = 60_000;

describe("nextSync", () => {
  test("keeps the newest sample and stamps the upload", () => {
    const sync = nextSync(null, [NOW - 30 * MINUTE, NOW - 5 * MINUTE], NOW);

    expect(sync).toEqual({ latestSampleTs: NOW - 5 * MINUTE, uploadTs: NOW });
  });

  test("a backfill of older samples never moves the latest sample back", () => {
    const previous = { latestSampleTs: NOW - MINUTE, uploadTs: NOW - MINUTE };

    const sync = nextSync(previous, [NOW - 400 * MINUTE], NOW);

    expect(sync).toEqual({ latestSampleTs: NOW - MINUTE, uploadTs: NOW });
  });

  test("ignores samples dated well into the future", () => {
    const sync = nextSync(null, [NOW - MINUTE, NOW + 60 * MINUTE], NOW);

    expect(sync.latestSampleTs).toBe(NOW - MINUTE);
  });
});

describe("lag", () => {
  test("is null while the data is recent", () => {
    expect(lag(NOW - LAG_MS, NOW)).toBeNull();
  });

  test("is how far behind once past the limit", () => {
    expect(lag(NOW - LAG_MS - MINUTE, NOW)).toBe(LAG_MS + MINUTE);
  });
});

describe("shortDuration", () => {
  test("uses minutes, then hours, then days", () => {
    expect(shortDuration(45 * MINUTE)).toBe("45m");
    expect(shortDuration(5 * 60 * MINUTE)).toBe("5h");
    expect(shortDuration(3 * 24 * 60 * MINUTE)).toBe("3d");
  });
});
