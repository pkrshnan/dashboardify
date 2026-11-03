import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { commitMessage, GitHistory } from "../../src/vault/git-history";

let dir: string;
let remote: string;

const newRepo = async (path: string, bare = false) => {
  const git = simpleGit(path);
  await git.init(bare, ["--initial-branch=main"]);
  await git.addConfig("user.name", "test");
  await git.addConfig("user.email", "test@example.com");
  return git;
};
const log = async (path: string) => (await simpleGit(path).log()).all.map((c) => c.message);
const options = { commitDelayMs: 10, sweepIntervalMs: 0 };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-"));
  remote = await mkdtemp(join(tmpdir(), "remote-"));
  await newRepo(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
});

describe("GitHistory", () => {
  test("batches writes into one commit", async () => {
    const history = new GitHistory(dir, options);
    await writeFile(join(dir, "a.md"), "a");
    history.noteWrite();
    await writeFile(join(dir, "b.md"), "b");
    history.noteWrite();
    await Bun.sleep(50);
    await history.flush();
    expect(await log(dir)).toEqual(["Update 2 files"]);
    expect(history.status.lastCommitAt).not.toBeNull();
    expect(history.status.lastPushAt).toBeNull();
  });

  test("does nothing when nothing changed", async () => {
    const history = new GitHistory(dir, options);
    await history.flush();
    expect(history.status.lastError).toBeNull();
    expect(history.status.lastCommitAt).toBeNull();
  });

  test("pushes to a backup remote when there is one", async () => {
    await newRepo(remote, true);
    await simpleGit(dir).addRemote("origin", remote);
    await writeFile(join(dir, "a.md"), "a");
    await simpleGit(dir).add(".").commit("first").push(["-u", "origin", "main"]);
    const history = new GitHistory(dir, options);
    await writeFile(join(dir, "a.md"), "changed");
    await history.flush();
    expect(await log(remote)).toEqual(["Update 1 file", "first"]);
    expect(history.status.lastPushAt).not.toBeNull();
  });

  test("keeps derived folders out of history", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/");
    const history = new GitHistory(dir, options);
    await history.start();
    await history.start();
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(
      "node_modules/\n.cc/\n.trash/\n.obsidian/workspace*.json\n",
    );
    history.stop();
  });

  test("records errors instead of throwing", async () => {
    await rm(join(dir, ".git"), { recursive: true });
    const history = new GitHistory(dir, options);
    await history.flush();
    expect(history.status.lastError).not.toBeNull();
  });
});

describe("commitMessage", () => {
  test("lists the first few paths", () => {
    const paths = ["a", "b", "c", "d", "e", "f", "g"];
    expect(commitMessage(paths)).toBe("Update 7 files\n\na\nb\nc\nd\ne\n…and 2 more");
  });
});
