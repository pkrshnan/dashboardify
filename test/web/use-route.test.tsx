import { beforeEach, describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/preact";
import { navigate, setQuery, useRoute } from "../../web/lib/use-route";
import { useDom } from "./dom";

useDom();

function Where() {
  const route = useRoute();
  return (
    <p>
      {route.path} {JSON.stringify(route.query)}
    </p>
  );
}

const shown = (container: Element) => container.textContent;

describe("useRoute", () => {
  beforeEach(() => {
    history.replaceState(null, "", "#/");
  });

  test("rewrites an old hash in place and reads it as an address", () => {
    history.replaceState(null, "", "#settings/devices");

    const { container } = render(<Where />);

    expect(shown(container)).toBe("/settings/devices {}");
    expect(window.location.hash).toBe("#/settings/devices");
  });

  test("follows navigation, adding a history entry", async () => {
    const { container } = render(<Where />);
    const before = history.length;

    await act(async () => {
      navigate("#/activity");
      await new Promise((done) => setTimeout(done, 0));
    });

    expect(shown(container)).toBe("/activity {}");
    expect(history.length).toBe(before + 1);
  });

  test("a query change replaces the entry and keeps the page", () => {
    history.replaceState(null, "", "#/activity");
    const { container } = render(<Where />);
    const before = history.length;

    act(() => setQuery({ range: "month" }));
    act(() => setQuery({ range: "" }));
    act(() => setQuery({ range: "3m" }));

    expect(shown(container)).toBe('/activity {"range":"3m"}');
    expect(history.length).toBe(before);
  });
});
