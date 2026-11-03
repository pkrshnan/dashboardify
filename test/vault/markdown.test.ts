import { describe, expect, test } from "bun:test";
import {
  appendToSection,
  mergeFrontmatter,
  parseNote,
  renderNote,
  replaceBlock,
  replaceBlockAtTop,
} from "../../src/vault/markdown";

describe("frontmatter", () => {
  test("round-trips and merges without touching the body", () => {
    const text = "---\ndate: 2026-11-02\ntags:\n  - daily\n---\n# Hello\n\nmy words\n";
    const note = mergeFrontmatter(parseNote(text), { recovery: 64, skipped: undefined });
    const out = renderNote(note);
    expect(out).toContain("recovery: 64");
    expect(out).not.toContain("skipped");
    expect(out.endsWith("# Hello\n\nmy words\n")).toBe(true);
    expect(parseNote(out).frontmatter.date).toBe("2026-11-02");
  });

  test("a note without frontmatter keeps its body", () => {
    expect(parseNote("just text").body).toBe("just text");
  });
});

describe("appendToSection", () => {
  test("appends inside the section, before the next heading", () => {
    const body = "# Day\n\n## Journal\n\n- 08:00 first\n\n## Notes\n\nmine\n";
    const out = appendToSection(body, "Journal", "- 09:00 second");
    expect(out).toBe("# Day\n\n## Journal\n\n- 08:00 first\n- 09:00 second\n\n## Notes\n\nmine\n");
  });

  test("fills an empty section", () => {
    expect(appendToSection("# Day\n\n## Journal\n", "Journal", "- 07:00 hi")).toBe(
      "# Day\n\n## Journal\n\n- 07:00 hi\n",
    );
  });

  test("creates a missing section", () => {
    expect(appendToSection("# Day\n", "Received", "- x")).toBe("# Day\n\n## Received\n\n- x\n");
  });
});

describe("replaceBlock", () => {
  test("replaces only the marked region", () => {
    const body = "before\n<!-- cc:health -->\nold\n<!-- /cc:health -->\nafter\n";
    expect(replaceBlock(body, "health", "new")).toBe(
      "before\n<!-- cc:health -->\nnew\n<!-- /cc:health -->\nafter\n",
    );
  });

  test("appends the region when absent", () => {
    expect(replaceBlock("text\n", "agenda", "a")).toBe(
      "text\n\n<!-- cc:agenda -->\na\n<!-- /cc:agenda -->\n",
    );
  });
});

describe("replaceBlockAtTop", () => {
  test("puts a new block under the title, above existing sections", () => {
    const body = "# 2026-11-02\n\n## Journal\n\n- 08:00 Hi\n";
    expect(replaceBlockAtTop(body, "health", "## Health\n\n- RHR 52")).toBe(
      "# 2026-11-02\n\n<!-- cc:health -->\n## Health\n\n- RHR 52\n<!-- /cc:health -->\n\n## Journal\n\n- 08:00 Hi\n",
    );
  });

  test("replaces an existing block in place", () => {
    const body = "# T\n\n<!-- cc:health -->\nold\n<!-- /cc:health -->\n\n## Journal\n";
    expect(replaceBlockAtTop(body, "health", "new")).toBe(
      "# T\n\n<!-- cc:health -->\nnew\n<!-- /cc:health -->\n\n## Journal\n",
    );
  });

  test("a note without a title gets the block first", () => {
    expect(replaceBlockAtTop("text\n", "health", "x")).toBe(
      "<!-- cc:health -->\nx\n<!-- /cc:health -->\n\ntext\n",
    );
  });
});
