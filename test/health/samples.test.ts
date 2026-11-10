import { describe, expect, test } from "bun:test";
import { mergeColumns, mergeSamples, type Upload } from "../../src/health/samples";

const T0 = Date.parse("2026-11-02T00:00:00Z");

/** An upload for one day: a header after `ts`, and one row of values per sample. */
const upload = (header: string[], ...rows: (number | string | null)[][]): Upload => ({
  header: ["ts", ...header],
  samples: rows.map((values, i) => ({ ts: T0 + i * 1000, values })),
});

describe("mergeColumns", () => {
  test("the first upload fixes the header; types come from the first value seen", () => {
    const first = mergeColumns(null, upload(["pct", "charging"], [null, 1]));
    expect(first).toEqual({
      ok: true,
      value: [
        { name: "pct", type: null },
        { name: "charging", type: "number" },
      ],
    });
    const known = first.ok ? first.value : [];
    expect(mergeColumns(known, upload(["pct", "charging"], [80, 0]))).toEqual({
      ok: true,
      value: [
        { name: "pct", type: "number" },
        { name: "charging", type: "number" },
      ],
    });
  });

  test("rejects a different header or a type change", () => {
    const known = [{ name: "bpm", type: "number" as const }];
    expect(mergeColumns(known, upload(["hr"], [60]))).toEqual({
      ok: false,
      error: "header must be ts,bpm",
    });
    expect(mergeColumns(known, upload(["bpm"], ["high"])).ok).toBe(false);
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
