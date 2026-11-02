import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../../src/vault/vault";

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-"));
  vault = new Vault(dir, "America/Los_Angeles");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = (rel: string) => readFile(join(dir, rel), "utf8");

describe("journal", () => {
  test("appends to the note for the local day, across the DST change", async () => {
    // DST ended at 02:00 on 2026-11-01 in Los Angeles; 02:30Z on Nov 2 is 18:30 PST on Nov 1.
    expect(await vault.appendJournal(new Date("2026-11-02T02:30:00Z"), "Long walk.\nFelt good.")).toEqual({
      path: "daily/2026/2026-11-01.md",
    });
    await vault.appendJournal(new Date("2026-11-02T06:00:00Z"), "Bed.");
    const note = await file("daily/2026/2026-11-01.md");
    expect(note).toContain("## Journal\n\n- 18:30 Long walk.\n  Felt good.\n- 22:00 Bed.\n");
    expect(note).toContain("date: 2026-11-01");
  });

  test("keeps text the user wrote outside the journal section", async () => {
    await vault.appendJournal(new Date("2026-11-02T18:00:00Z"), "one");
    const path = join(dir, "daily/2026/2026-11-02.md");
    await Bun.write(path, `${await file("daily/2026/2026-11-02.md")}\n## Notes\n\nmine\n`);
    await vault.appendJournal(new Date("2026-11-02T19:00:00Z"), "two");
    const note = await file("daily/2026/2026-11-02.md");
    expect(note).toContain("- 10:00 one\n- 11:00 two\n\n## Notes\n\nmine\n");
  });

  test("parallel writes to one note are all kept", async () => {
    const at = new Date("2026-11-02T18:00:00Z");
    await Promise.all(Array.from({ length: 25 }, (_, i) => vault.appendJournal(at, `entry ${i}`)));
    expect((await file("daily/2026/2026-11-02.md")).match(/entry \d+/g)?.length).toBe(25);
  });

  test("leaves no temp files behind", async () => {
    await vault.appendJournal(new Date("2026-11-02T18:00:00Z"), "x");
    expect(await readdir(join(dir, "daily/2026"))).toEqual(["2026-11-02.md"]);
  });
});

describe("health", () => {
  test("merges frontmatter and upserts the monthly CSV row", async () => {
    await vault.recordHealth("2026-11-02", { recovery: 64, hrv_ms: 58.24 }, "whoop");
    await vault.recordHealth("2026-11-01", { steps: 8412 }, "apple-health");
    await vault.recordHealth("2026-11-02", { recovery: 70 }, "whoop");
    expect(await file("health/2026/2026-11.csv")).toBe(
      "date,hrv_ms,recovery,steps,source\n2026-11-01,,,8412,apple-health\n2026-11-02,58.24,70,,whoop\n",
    );
    const note = await file("daily/2026/2026-11-02.md");
    expect(note).toContain("recovery: 70");
    expect(note).toContain("hrv_ms: 58.24");
  });
});

describe("messages", () => {
  test("writes a local-only file and ignores a repeated id", async () => {
    const msg = {
      id: "m1",
      sender: "Sam_[x]",
      text: "Call me\nwhen free -->",
      receivedAt: new Date("2026-11-02T20:05:00Z"),
    };
    expect((await vault.appendMessage(msg)).duplicate).toBe(false);
    expect((await vault.appendMessage(msg)).duplicate).toBe(true);
    const out = await file("inbox/messages/2026-11-02.md");
    expect(out).toContain("privacy: local-only");
    expect(out).toContain("- 12:05 **Sam\\_\\[x\\]**: Call me when free <!-- id:m1 -->");
    expect(out.match(/Call me/g)?.length).toBe(1);
  });
});

describe("update", () => {
  test("skips the write and listeners when nothing changed", async () => {
    const writes: string[] = [];
    vault.onWrite((p) => writes.push(p));
    expect(await vault.update("notes/a.md", () => "hello\n")).toBe(true);
    expect(await vault.update("notes/a.md", () => "hello\n")).toBe(false);
    expect(await vault.update("notes/a.md", () => null)).toBe(false);
    expect(writes).toEqual(["notes/a.md"]);
  });

  test("a failed update does not block the next one", async () => {
    await expect(
      vault.update("notes/b.md", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await vault.update("notes/b.md", () => "ok\n")).toBe(true);
  });
});
