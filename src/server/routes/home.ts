import { Hono } from "hono";
import { type HomeDeps, homeView } from "../../home/home";
import type { AuthEnv } from "../auth";

/** GET /home: everything the home screen shows, in one response. */
export function homeRoutes(deps: HomeDeps, now: () => Date = () => new Date()): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.get("/", async (c) => c.json(await homeView(deps, now())));
  return routes;
}
