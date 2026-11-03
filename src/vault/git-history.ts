// Commits the vault to a local git repo so every change has history and can be undone.
// Devices sync through LiveSync, not git; git is only history and an optional backup remote.
//
// A write starts a short timer, and when it fires everything changed since is committed
// together. Edits that arrive through LiveSync are picked up by a slower periodic commit.
// If the repo has a remote, each commit is pushed to it. It never pulls or force-pushes.

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";

/** Derived or device-local folders that never belong in history. */
const IGNORED = [".cc/", ".trash/", ".obsidian/workspace*.json"];

export interface GitHistoryOptions {
  /** Delay between the first server write and the commit, in ms. */
  commitDelayMs: number;
  /** How often to commit edits made elsewhere, in ms. 0 turns it off. */
  sweepIntervalMs: number;
  log?: (message: string) => void;
}

export interface GitHistoryStatus {
  lastCommitAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
}

export class GitHistory {
  private readonly git: SimpleGit;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sweep: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> = Promise.resolve();
  readonly status: GitHistoryStatus = { lastCommitAt: null, lastPushAt: null, lastError: null };

  constructor(
    private readonly root: string,
    private readonly options: GitHistoryOptions,
  ) {
    this.git = simpleGit(root);
  }

  async start(): Promise<void> {
    await ignore(this.root, IGNORED);
    if (this.options.sweepIntervalMs > 0) {
      this.sweep = setInterval(() => this.commitSoon(0), this.options.sweepIntervalMs);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.sweep) {
      clearInterval(this.sweep);
    }
  }

  /** Call after the server writes a file. Batches into one commit after `commitDelayMs`. */
  noteWrite(): void {
    this.commitSoon(this.options.commitDelayMs);
  }

  /** Commit (and push) whatever has changed now. Runs after any commit already in progress. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = this.running.then(() => this.commit());
    return this.running;
  }

  private commitSoon(delayMs: number): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delayMs);
  }

  private async commit(): Promise<void> {
    try {
      const changed = await this.changedFiles();
      if (changed.length === 0) {
        return;
      }
      await this.git.add("-A");
      await this.git.commit(commitMessage(changed));
      this.status.lastCommitAt = new Date().toISOString();
      await this.push();
      this.status.lastError = null;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.options.log?.(`git history: ${this.status.lastError}`);
    }
  }

  private async changedFiles(): Promise<string[]> {
    return (await this.git.status()).files.map((file) => file.path);
  }

  private async push(): Promise<void> {
    const remotes = await this.git.getRemotes();
    if (remotes.length === 0) {
      return;
    }
    await this.git.push();
    this.status.lastPushAt = new Date().toISOString();
  }
}

/** Add any missing patterns to the vault's .gitignore. */
async function ignore(root: string, patterns: string[]): Promise<void> {
  const path = join(root, ".gitignore");
  const current = await readFile(path, "utf8").catch(() => "");
  const lines = new Set(current.split("\n").map((line) => line.trim()));
  const missing = patterns.filter((pattern) => !lines.has(pattern));
  if (missing.length > 0) {
    const gap = current === "" || current.endsWith("\n") ? "" : "\n";
    await appendFile(path, `${gap}${missing.join("\n")}\n`);
  }
}

const LISTED_FILES = 5;

/** "Update 3 files" plus the paths, so `git log` shows what changed at a glance. */
export function commitMessage(paths: string[]): string {
  const noun = paths.length === 1 ? "file" : "files";
  const listed = paths.slice(0, LISTED_FILES).join("\n");
  const more = paths.length > LISTED_FILES ? `\n…and ${paths.length - LISTED_FILES} more` : "";
  return `Update ${paths.length} ${noun}\n\n${listed}${more}`;
}
