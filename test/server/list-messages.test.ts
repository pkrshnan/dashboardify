import { describe, expect, test } from "bun:test";
import type { ListSummary } from "../../src/lists/list-store";
import {
  addedSentence,
  findList,
  noListSentence,
  spokenEntries,
} from "../../src/server/list-messages";

const list = (title: string, slug: string): ListSummary => ({
  title,
  slug,
  path: `Lists/${title}.md`,
  openCount: 0,
});

const LISTS = [list("Packing, Lisbon", "packing-lisbon"), list("Shopping", "shopping")];

describe("findList", () => {
  test.each([
    ["shopping", "shopping"],
    ["the shopping list", "shopping"],
    ["My Shopping List", "shopping"],
    ["packing", "packing-lisbon"],
    ["lisbon", "packing-lisbon"],
  ])("%s finds %s", (spoken, slug) => {
    expect(findList(spoken, LISTS)?.slug).toBe(slug);
  });

  test("nothing close finds nothing, and the answer names the lists there are", () => {
    expect(findList("films", LISTS)).toBeUndefined();
    expect(noListSentence("films", LISTS)).toBe(
      "There's no list called films. Your lists are Packing, Lisbon and Shopping.",
    );
    expect(noListSentence("films", [])).toBe("There's no list called films.");
  });
});

describe("spokenEntries", () => {
  test("commas and 'and' separate items", () => {
    expect(spokenEntries("oat milk and eggs, bread", [])).toEqual(["oat milk", "eggs", "bread"]);
  });

  test("a phrase already on the list keeps its 'and'", () => {
    expect(spokenEntries("mac and cheese and eggs", [])).toEqual(["mac", "cheese", "eggs"]);
    expect(spokenEntries("Mac and cheese", ["mac and cheese"])).toEqual(["Mac and cheese"]);
  });
});

describe("addedSentence", () => {
  test("says what was added, and what was already there", () => {
    expect(addedSentence("Shopping", ["oat milk", "eggs"], [])).toBe(
      "Added oat milk and eggs to Shopping.",
    );
    expect(addedSentence("Shopping", ["eggs"], ["bread"])).toBe(
      "Added eggs to Shopping. Bread was already on it.",
    );
    expect(addedSentence("Shopping", [], ["bread", "tea"])).toBe(
      "Bread and tea were already on Shopping.",
    );
  });
});
