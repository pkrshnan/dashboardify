// Keeps the vault in step with its git remote so other devices (Obsidian with git, a laptop
// clone) see what the server writes, and the server sees what they write.
//
// - Writes are batched: the first write starts a short timer; when it fires, every file
//   written since is committed together.
// - Before pushing, the server rebases onto the remote. If that conflicts, the rebase is
//   aborted, local commits are kept, nothing is pushed, and `status.conflict` is set until a
//   later sync succeeds. It never force-pushes.
// - The remote is also pulled on an interval, so edits made elsewhere show up without a write.

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface GitSyncOptions {
  /** Delay between the first write and the commit, in ms. */
  commitDelayMs?: number;
  /** How often to pull when idle, in ms. 0 disables. */
  pullIntervalMs?: number;
  log?: (msg: string) => void;
}

export interface GitSyncStatus {
  enabled: boolean;
  hasRemote: boolean;
  pending: number;
  lastCommitAt: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  conflict: boolean;
  lastError: string | null;
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
}

export class GitSync {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly commitDelayMs: number;
  private readonly pullIntervalMs: number;
  private readonly log: (msg: string) => void;
  readonly status: GitSyncStatus = {
    enabled: false,
    hasRemote: false,
    pending: 0,
    lastCommitAt: null,
    lastPushAt: null,
    lastPullAt: null,
    conflict: false,
    lastError: null,
  };

  constructor(
    readonly root: string,
    options: GitSyncOptions = {},
  ) {
    this.commitDelayMs = options.commitDelayMs ?? 30_000;
    this.pullIntervalMs = options.pullIntervalMs ?? 5 * 60_000;
    this.log = options.log ?? ((msg) => console.log(`[git] ${msg}`));
  }

  /** Check the vault is a repo, keep `.cc/` out of it, and start the pull interval. */
  async start(): Promise<void> {
    await this.git(["rev-parse", "--is-inside-work-tree"]);
    // Only sync with a remote when the current branch tracks one.
    this.status.hasRemote = await this.git(["rev-parse", "--abbrev-ref", "@{upstream}"]).then(
      () => true,
      () => false,
    );
    this.status.enabled = true;
    if (await this.ignoreServerState()) {
      this.noteWrite(".gitignore");
    }
    if (this.status.hasRemote && this.pullIntervalMs > 0) {
      this.interval = setInterval(
        () => void this.pull().catch(() => undefined),
        this.pullIntervalMs,
      );
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.timer = this.interval = null;
  }

  /** Record a written vault-relative path; schedules a commit. */
  noteWrite(path: string): void {
    if (!this.status.enabled) {
      return;
    }
    this.pending.add(path);
    this.status.pending = this.pending.size;
    this.timer ??= setTimeout(() => void this.flush().catch(() => undefined), this.commitDelayMs);
  }

  /** Commit pending writes now, then rebase onto the remote and push. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = null;
    return this.serial(async () => {
      const paths = [...this.pending];
      this.pending.clear();
      this.status.pending = 0;
      if (paths.length > 0) {
        await this.git(["add", "--", ...paths]);
        const staged = await this.git(["diff", "--cached", "--name-only"]);
        if (staged.trim()) {
          await this.git(["commit", "--quiet", "-m", commitMessage(paths)]);
          this.status.lastCommitAt = new Date().toISOString();
        }
      }
      if (this.status.hasRemote) {
        await this.rebaseAndPush();
      }
    });
  }

  /** Bring in remote changes without pushing. */
  pull(): Promise<void> {
    return this.serial(async () => {
      if (!this.status.hasRemote) {
        return;
      }
      await this.rebaseOntoRemote();
    });
  }

  // ---- internals ---------------------------------------------------------

  private async rebaseAndPush(): Promise<void> {
    if (!(await this.rebaseOntoRemote())) {
      return;
    }
    const ahead = await this.git(["rev-list", "--count", "@{upstream}..HEAD"]).catch(() => "1");
    if (Number(ahead.trim()) === 0) {
      return;
    }
    await this.git(["push", "--quiet"]);
    this.status.lastPushAt = new Date().toISOString();
  }

  /** Returns false (and keeps local commits) when the rebase conflicts. */
  private async rebaseOntoRemote(): Promise<boolean> {
    await this.git(["fetch", "--quiet"]);
    try {
      await this.git(["rebase", "--quiet", "--autostash", "@{upstream}"]);
    } catch (err) {
      await this.git(["rebase", "--abort"]).catch(() => undefined);
      this.status.conflict = true;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.log(`rebase conflicted; local commits kept, push skipped: ${this.status.lastError}`);
      return false;
    }
    this.status.conflict = false;
    this.status.lastError = null;
    this.status.lastPullAt = new Date().toISOString();
    return true;
  }

  /** Make sure the server's own state never gets committed. Returns true if .gitignore changed. */
  private async ignoreServerState(): Promise<boolean> {
    const path = join(this.root, ".gitignore");
    const current = await readFile(path, "utf8").catch(() => "");
    if (current.split("\n").some((l) => l.trim() === ".cc/" || l.trim() === ".cc")) {
      return false;
    }
    await appendFile(path, `${current && !current.endsWith("\n") ? "\n" : ""}.cc/\n`);
    return true;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch((err) => {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.log(this.status.lastError);
    });
    return run;
  }

  private async git(args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
      cwd: this.root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new GitError(args, code, stderr);
    }
    return stdout;
  }
}

export function commitMessage(paths: string[]): string {
  const sorted = [...paths].sort();
  if (sorted.length === 1) {
    return `dashboardify: update ${sorted[0]}`;
  }
  return `dashboardify: update ${sorted.length} files\n\n${sorted.map((p) => `- ${p}`).join("\n")}`;
}
