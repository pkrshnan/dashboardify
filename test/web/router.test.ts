import { describe, expect, test } from "bun:test";
import { formatAddress, href, matchPath, parseAddress, upgradeHash } from "../../web/lib/router";

describe("addresses", () => {
  test.each([
    ["#/", { path: "/", query: {} }],
    ["", { path: "/", query: {} }],
    ["#/activity", { path: "/activity", query: {} }],
    ["#/activity/", { path: "/activity", query: {} }],
    ["#/activity?range=month", { path: "/activity", query: { range: "month" } }],
    ["#/settings/calendars", { path: "/settings/calendars", query: {} }],
    ["#/?view=week&x=a%20b", { path: "/", query: { view: "week", x: "a b" } }],
  ])("%s reads as its path and query", (hash, address) => {
    expect(parseAddress(hash)).toEqual(address);
  });

  test("an address written out reads back the same", () => {
    const address = { path: "/settings/devices", query: { open: "add device" } };

    expect(parseAddress(formatAddress(address))).toEqual(address);
  });

  test("empty query values are left out", () => {
    expect(href("/", { view: "" })).toBe("#/");
    expect(href("/activity", { range: "3m" })).toBe("#/activity?range=3m");
  });
});

describe("old hashes", () => {
  test.each([
    ["#home", "#/"],
    ["#activity", "#/activity"],
    ["#settings", "#/settings"],
    ["#settings/devices", "#/settings/devices"],
    ["", "#/"],
    ["#", "#/"],
    ["#nonsense", "#/"],
  ])("%s becomes %s", (hash, upgraded) => {
    expect(upgradeHash(hash)).toBe(upgraded);
  });

  test("addresses and sign-in links are left alone", () => {
    expect(upgradeHash("#/")).toBeNull();
    expect(upgradeHash("#/activity?range=month")).toBeNull();
    expect(upgradeHash("#token=dfy_abc")).toBeNull();
  });
});

describe("matchPath", () => {
  test("fixed segments must match", () => {
    expect(matchPath("/activity", "/activity")).toEqual({});
    expect(matchPath("/activity", "/")).toBeNull();
    expect(matchPath("/activity", "/activity/extra")).toBeNull();
  });

  test("a parameter takes one segment, and a trailing ? makes it optional", () => {
    expect(matchPath("/settings/:section?", "/settings/devices")).toEqual({ section: "devices" });
    expect(matchPath("/settings/:section?", "/settings")).toEqual({});
    expect(matchPath("/lists/:list", "/lists")).toBeNull();
    expect(matchPath("/settings/:section?", "/calendar")).toBeNull();
  });
});
