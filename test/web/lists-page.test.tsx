import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { AppContext } from "../../web/modules/context";
import { lists } from "../../web/modules/lists";
import { useDom } from "./dom";

useDom();

const SHOPPING = {
  name: "lists/shopping",
  title: "Shopping",
  path: "Lists/Shopping.md",
  openCount: 2,
  etag: "e1",
  sections: [
    { items: [{ name: "lists/shopping/items/a1", text: "Coffee beans" }] },
    {
      title: "Produce",
      items: [
        { name: "lists/shopping/items/b2", text: "Spinach", note: "2 bags" },
        { name: "lists/shopping/items/c3", text: "Lemons", done: true },
      ],
    },
  ],
};

/** The calls the page made, answered with the Shopping list above. */
let calls: { method: string; url: string; body: unknown }[];
let original: typeof fetch;

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    const answer = url === "/v1/lists" ? { lists: [{ ...SHOPPING, sections: [] }] } : SHOPPING;
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function showList(isPhone = false) {
  const View = lists.view;
  return render(
    <AppContext.Provider value={{ token: "t", onUnauthorized: () => undefined, isPhone }}>
      <View
        route={{ path: "/lists/shopping", query: {} }}
        params={{ list: "shopping" }}
        home={null}
      />
    </AppContext.Provider>,
  );
}

describe("Lists page", () => {
  test("shows open items by section, what's left, and the done ones apart", async () => {
    const page = showList();

    await page.findByText("Spinach");

    expect(page.getByText("2 left")).toBeTruthy();
    expect(page.getByText("2 bags")).toBeTruthy();
    expect(page.getByText("Done · 1")).toBeTruthy();
    expect(page.getByRole("link", { name: /Shopping/ }).getAttribute("aria-current")).toBe("page");
  });

  test("a tap ticks the item at once and sends done with its update mask", async () => {
    const page = showList();
    const spinach = await page.findByRole("button", { name: /^Spinach/ });

    await act(async () => {
      fireEvent.click(spinach);
    });

    expect(page.getByText("1 left")).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      url: "/v1/lists/shopping/items/b2?updateMask=done",
      body: { done: true },
    });
  });

  test("Return adds what's typed and clears the box", async () => {
    const page = showList();
    const box = (await page.findByLabelText("Add to Shopping")) as HTMLInputElement;

    fireEvent.input(box, { target: { value: "eggs, bread" } });
    await act(async () => {
      fireEvent.submit(box.closest("form") as HTMLFormElement);
    });

    await waitFor(() => expect(box.value).toBe(""));
    expect(calls.find((c) => c.method === "POST")).toEqual({
      method: "POST",
      url: "/v1/lists/shopping/items",
      body: { texts: ["eggs, bread"], section: "" },
    });
  });

  test("the section menu adds under a heading, or a new one", async () => {
    const page = showList();
    const box = (await page.findByLabelText("Add to Shopping")) as HTMLInputElement;
    const pick = page.getByRole("button", { name: "Section" });
    const choose = (name: string) => {
      fireEvent.click(pick);
      fireEvent.click(page.getByRole("menuitemradio", { name }));
    };
    const add = async (text: string) => {
      fireEvent.input(box, { target: { value: text } });
      await act(async () => {
        fireEvent.submit(box.closest("form") as HTMLFormElement);
      });
    };

    fireEvent.click(pick);
    expect(page.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual([
      "No section",
      "Produce",
      "New section…",
    ]);
    fireEvent.keyDown(pick, { key: "Escape" });
    expect(page.queryByRole("menu")).toBeNull();
    choose("Produce");
    expect(page.queryByRole("menu")).toBeNull();
    expect(pick.textContent).toBe("Produce");
    expect(box.placeholder).toContain("Add to Produce");
    await add("Kale");
    choose("New section…");
    fireEvent.input(page.getByLabelText("New section's name"), { target: { value: "Bakery" } });
    // Two boxes: browsers submit on Return only when the form has a submit button.
    expect(box.closest("form")?.querySelector('button[type="submit"]')).toBeTruthy();
    await add("Bread");

    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { texts: ["Kale"], section: "Produce" },
      { texts: ["Bread"], section: "Bakery" },
    ]);
  });

  test("an open item's handle moves it a section down or up with the arrow keys", async () => {
    const page = showList();
    const coffee = await page.findByRole("button", { name: "Move Coffee beans" });

    expect(page.getByRole("button", { name: "Move Spinach" })).toBeTruthy();
    expect(page.queryByRole("button", { name: "Move Lemons" })).toBeNull();
    // Already at the top: nothing to send.
    fireEvent.keyDown(coffee, { key: "ArrowUp" });
    await act(async () => {
      fireEvent.keyDown(coffee, { key: "ArrowDown" });
    });

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([
      {
        method: "PATCH",
        url: "/v1/lists/shopping/items/a1?updateMask=section",
        body: { section: "Produce" },
      },
    ]);
  });

  test("on the phone, a list has a way back to the lists", async () => {
    const page = showList(true);

    expect((await page.findByText("‹ Lists")).getAttribute("href")).toBe("#/lists");
  });
});
