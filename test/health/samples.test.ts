import { describe, expect, test } from "bun:test";
import { mergeColumns, mergeSamples, parseUpload } from "../../src/health/samples";

const DAY = "2026-11-02";
const T0 = Date.parse("2026-11-02T00:00:00Z");

const upload = (csv: string) => {
  const parsed = parseUpload(csv, DAY);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

describe("parseUpload", () => {
  test("reads numbers, text and empty cells", () => {
    expect(upload(`ts,bpm,state\n${T0},61,\n${T0 + 1000},62.5,SLEEP\n`)).toEqual({
      header: ["ts", "bpm", "state"],
      samples: [
        { ts: T0, values: [61, null] },
        { ts: T0 + 1000, values: [62.5, "SLEEP"] },
      ],
    });
  });

  test("names the line of a ts outside the day", () => {
    expect(parseUpload(`ts,bpm\n${T0},60\n${T0 - 1},60\n`, DAY)).toEqual({
      ok: false,
      error: "line 3: ts is outside the day",
    });
  });

  test("rejects bad headers and rows", () => {
    expect(parseUpload("time,bpm\n", DAY).ok).toBe(false);
    expect(parseUpload("ts,BPM\n", DAY).ok).toBe(false);
    expect(parseUpload("ts,bpm,bpm\n", DAY).ok).toBe(false);
    expect(parseUpload(`ts,bpm\n${T0},60,1\n`, DAY)).toEqual({
      ok: false,
      error: "line 2: expected 2 cells, got 3",
    });
    expect(parseUpload("ts,bpm\nsoon,60\n", DAY).ok).toBe(false);
  });
});

describe("mergeColumns", () => {
  test("the first upload fixes the header; types come from the first value seen", () => {
    const first = mergeColumns(null, upload(`ts,pct,charging\n${T0},,1\n`));
    expect(first).toEqual({
      ok: true,
      value: [
        { name: "pct", type: null },
        { name: "charging", type: "number" },
      ],
    });
    const known = first.ok ? first.value : [];
    expect(mergeColumns(known, upload(`ts,pct,charging\n${T0},80,0\n`))).toEqual({
      ok: true,
      value: [
        { name: "pct", type: "number" },
        { name: "charging", type: "number" },
      ],
    });
  });

  test("rejects a different header or a type change", () => {
    const known = [{ name: "bpm", type: "number" as const }];
    expect(mergeColumns(known, upload(`ts,hr\n${T0},60\n`))).toEqual({
      ok: false,
      error: "header must be ts,bpm",
    });
    expect(mergeColumns(known, upload(`ts,bpm\n${T0},high\n`)).ok).toBe(false);
  });
});

describe("mergeSamples", () => {
  test("adds new timestamps, lets the newer upload win, and sorts by ts", () => {
    const existing = [
      { ts: 2, values: [60] },
      { ts: 1, values: [59] },
    ];
    const incoming = [
      { ts: 2, values: [61] },
      { ts: 3, values: [62] },
    ];
    expect(mergeSamples(existing, incoming)).toEqual({
      samples: [
        { ts: 1, values: [59] },
        { ts: 2, values: [61] },
        { ts: 3, values: [62] },
      ],
      added: 1,
      replaced: 1,
    });
  });
});
