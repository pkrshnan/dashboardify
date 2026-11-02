import { Hono } from "hono";
import type { Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import { badRequest, instant, readBody, requiredText } from "../validate";

/** POST /ingest/journal: append a line to the day's journal. */
export function journalRoutes(vault: Vault): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/", async (c) => {
    const body = (await readBody(c.req.raw)) ?? {};
    const text = requiredText(body.text, "text");
    if (!text.ok) {
      return badRequest(c, text.error);
    }
    const at = instant(body.at, "at");
    if (!at.ok) {
      return badRequest(c, at.error);
    }
    return c.json(await vault.appendJournal(at.value, text.value), 201);
  });

  return routes;
}
