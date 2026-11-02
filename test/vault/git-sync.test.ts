import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitMessage, GitSync } from "../../src/vault/git-sync";
import { Vault } from "../../src/vault/vault";

let base: string;
let remote: string;
let server: string; // the vault the server writes to
let laptop: string; // another clone, standing in for your other devices
let sync: GitSync;
let vault: Vault;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

async function clone(name: string): Promise<string> {
  const dir = join(base, name);
  await git(base, "clone", "--quiet", remote, dir);
  await git(dir, "config", "user.email", `${name}@example.com`);
  await git(dir, "config", "user.name", name);
  return dir;
}

const at = new Date("2026-11-02T18:00:00Z");

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "gitsync-"));
  remote = join(base, "remote.git");
  await git(base, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  const seed = await clone("seed");
  await writeFile(join(seed, "README.md"), "vault\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "--quiet", "-m", "seed");
  await git(seed, "push", "--quiet", "origin", "main");
  server = await clone("server");
  laptop = await clone("laptop");
  sync = new GitSync(server, { commitDelayMs: 60_000, pullIntervalMs: 0, log: () => undefined });
  await sync.start();
  vault = new Vault(server, "America/Los_Angeles");
  vault.onWrite((p) => sync.noteWrite(p));
});

afterEach(async () => {
  sync.stop();
  await rm(base, { recursive: true, force: true });
});

const remoteLog = () => git(remote, "log", "--format=%s", "main");

describe("GitSync", () => {
  test("ignores .cc/ and commits that change with the first batch", async () => {
    expect(await readFile(join(server, ".gitignore"), "utf8")).toBe(".cc/\n");
    await sync.flush();
    expect(await remoteLog()).toBe("dashboardify: update .gitignore\nseed");
  });

  test("batches writes into one commit and pushes it", async () => {
    await vault.appendJournal(at, "one");
    await vault.recordHealth("2026-11-02", { steps: 100 }, "apple-health");
    expect(sync.status.pending).toBe(3); // .gitignore, daily note, health csv
    await sync.flush();
    const subject = (await remoteLog()).split("\n")[0];
    expect(subject).toBe("dashboardify: update 3 files");
    expect(sync.status).toMatchObject({ pending: 0, conflict: false, lastError: null });
    expect(sync.status.lastPushAt).not.toBeNull();
  });

  test("never commits server state", async () => {
    await vault.syncReminders("full", [{ id: "a", title: "x", list: "L" }], [], at);
    await sync.flush();
    const files = await git(remote, "ls-tree", "-r", "--name-only", "main");
    expect(files.split("\n").sort()).toEqual([".gitignore", "README.md", "tasks/reminders.md"]);
  });

  test("rebases onto edits made elsewhere to other files", async () => {
    await writeFile(join(laptop, "notes.md"), "from laptop\n");
    await git(laptop, "add", ".");
    await git(laptop, "commit", "--quiet", "-m", "laptop edit");
    await git(laptop, "push", "--quiet");

    await vault.appendJournal(at, "from server");
    await sync.flush();
    expect((await remoteLog()).split("\n")).toEqual(["dashboardify: update 2 files", "laptop edit", "seed"]);
    expect(await readFile(join(server, "notes.md"), "utf8")).toBe("from laptop\n");
  });

  test("on a conflict, keeps local commits, skips the push, and recovers later", async () => {
    await vault.appendJournal(at, "server line");
    await sync.flush();
    await git(laptop, "pull", "--quiet");

    // Both sides edit the same line of the same note.
    const note = "daily/2026/2026-11-02.md";
    const laptopText = (await readFile(join(laptop, note), "utf8")).replace("server line", "laptop line");
    await writeFile(join(laptop, note), laptopText);
    await git(laptop, "commit", "--quiet", "-am", "laptop rewrite");
    await git(laptop, "push", "--quiet");
    await vault.update(note, (t) => t?.replace("server line", "server edit") ?? null);
    await sync.flush();

    expect(sync.status.conflict).toBe(true);
    expect(await git(server, "status", "--porcelain")).toBe("");
    expect(await git(server, "log", "-1", "--format=%s")).toBe("dashboardify: update daily/2026/2026-11-02.md");
    expect((await remoteLog()).split("\n")[0]).toBe("laptop rewrite");

    // Resolve on the laptop by taking the server's version; the next sync goes through.
    await writeFile(join(laptop, note), await readFile(join(server, note), "utf8"));
    await git(laptop, "commit", "--quiet", "-am", "resolve");
    await git(laptop, "push", "--quiet");
    await git(server, "reset", "--quiet", "--hard", "origin/main");
    await sync.pull();
    expect(sync.status.conflict).toBe(false);
  });

  test("works without a remote", async () => {
    const solo = join(base, "solo");
    await git(base, "init", "--quiet", solo);
    await git(solo, "config", "user.email", "s@example.com");
    await git(solo, "config", "user.name", "s");
    const local = new GitSync(solo, { pullIntervalMs: 0, log: () => undefined });
    await local.start();
    expect(local.status.hasRemote).toBe(false);
    await local.flush();
    expect(await git(solo, "log", "--format=%s")).toBe("dashboardify: update .gitignore");
  });
});

test("commitMessage lists files when there are several", () => {
  expect(commitMessage(["b.md"])).toBe("dashboardify: update b.md");
  expect(commitMessage(["b.md", "a.md"])).toBe("dashboardify: update 2 files\n\n- a.md\n- b.md");
});
