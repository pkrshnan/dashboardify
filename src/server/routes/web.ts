import { join } from "node:path";
import { Hono } from "hono";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "..", "web", "public");
const FILES: Record<string, string> = {
  "/icon.svg": "image/svg+xml",
  "/icon-512.png": "image/png",
  "/apple-touch-icon.png": "image/png",
};

/**
 * The icons that the web app manifest points to. The page, its script, styles and manifest are
 * bundled and served by Bun from web/index.html (see main.ts). None of these need a token.
 */
export function webRoutes(): Hono {
  const routes = new Hono();
  for (const [path, type] of Object.entries(FILES)) {
    routes.get(path, (c) =>
      c.body(Bun.file(join(PUBLIC_DIR, path)).stream(), 200, { "content-type": type }),
    );
  }
  return routes;
}
