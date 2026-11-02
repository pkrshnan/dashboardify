import { Hono } from "hono";
import { localDate } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import type { Config } from "../config";
import { badRequest, isoDate } from "../validate";

/** GET /today?date=YYYY-MM-DD: the daily note, defaulting to today. */
export function todayRoutes(vault: Vault, config: Config): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) => {
    const date = isoDate(c.req.query("date"), localDate(new Date(), config.timeZone));
    if (!date.ok) {
      return badRequest(c, date.error);
    }
    const note = await vault.readDaily(date.value);
    return c.json({
      date: date.value,
      path: vault.dailyPath(date.value),
      frontmatter: note?.frontmatter ?? {},
      body: note?.body ?? null,
    });
  });

  return routes;
}
