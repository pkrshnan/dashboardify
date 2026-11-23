import { join } from "node:path";
import { Hono } from "hono";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "..", "web", "public");
const FILES: Record<string, Record<string, string>> = {
  "/icon.svg": { "content-type": "image/svg+xml" },
  "/icon-512.png": { "content-type": "image/png" },
  "/apple-touch-icon.png": { "content-type": "image/png" },
  // At the root, so its scope is the whole app; checked on every load, so a new one is picked up.
  "/sw.js": { "content-type": "text/javascript", "cache-control": "no-cache" },
};

/**
 * The icons that the web app manifest points to, and the service worker. The page, its script,
 * styles and manifest are bundled and served by Bun from web/index.html (see main.ts). None of
 * these need a token.
 */
export function webRoutes(): Hono {
  const routes = new Hono();
  for (const [path, headers] of Object.entries(FILES)) {
    routes.get(path, (c) => c.body(Bun.file(join(PUBLIC_DIR, path)).stream(), 200, headers));
  }
  return routes;
}
