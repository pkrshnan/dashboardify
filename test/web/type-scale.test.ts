import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "../../web");

// A pixel size typed into one rule is how text of one role drifts to a different size elsewhere.
test("every font size comes from the type scale", () => {
  const css = readFileSync(join(web, "styles.css"), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1] ?? "");
  const stray = sizes.filter(
    (s) => !/^var\(--type-[a-z]+\)( !important)?$/.test(s) && s !== "inherit" && s !== "0",
  );
  expect(stray).toEqual([]);
});

test("components set no font size inline", () => {
  const files = new Bun.Glob("{components,modules,settings}/*.tsx").scanSync(web);
  const inline = [...files].filter((f) => readFileSync(join(web, f), "utf8").includes("fontSize"));
  expect(inline).toEqual([]);
});
