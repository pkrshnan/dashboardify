import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server/app";

/** Call inside a describe block to give each test an isolated vault and sample store. */
export function useApi() {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "api-"));
    await Bun.write(join(dir, "vault/Inbox.md"), "");
    app = createApp(
      {
        vaultPath: join(dir, "vault"),
        port: 0,
        timeZone: "UTC",
        healthRawPath: join(dir, "raw"),
        healthDerivedPath: join(dir, "derived"),
        tasksInbox: "Inbox.md",
        tokens: new Map([["test", "secret"]]),
      },
      { now: () => new Date("2026-11-03T12:00:00Z") },
    );
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  return {
    get app() {
      return app;
    },
    async call(path: string, method = "GET", body?: unknown) {
      const response = await app.request(path, {
        method,
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
