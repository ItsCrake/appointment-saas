import { describe, expect, it, vi } from "vitest";

import { createStore } from "./settings-dirty";

/**
 * The registry behind the settings save bar.
 *
 * Tested as a plain object rather than through the component, because the two
 * properties that matter are not visual:
 *
 * 1. it notifies **only when the set of dirty sections changes** — sections
 *    re-register on nearly every render to keep their save closures fresh, so
 *    without that guard the bar would re-render on every keystroke on the page;
 * 2. a section that unmounts stops counting, or an owner would be told they
 *    have unsaved changes in a form that is no longer on screen.
 */

const section = (dirty: boolean, label = "section") => ({
  label,
  dirty,
  save: async () => ({ ok: true }) as const,
  reset: () => {},
});

describe("settings dirty registry", () => {
  it("reports nothing dirty until a section says so", () => {
    const store = createStore();
    store.set("a", section(false));

    expect(store.getSnapshot()).toBe("");
    expect(store.dirtySections()).toEqual([]);
  });

  it("notifies when a section becomes dirty", () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("a", section(false));
    expect(listener).not.toHaveBeenCalled();

    store.set("a", section(true));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.dirtySections()).toHaveLength(1);
  });

  it("stays silent while a dirty section merely re-registers", () => {
    // The keystroke case. Every character typed re-registers the section with a
    // fresh `save` closure; none of those is a change the bar cares about.
    const store = createStore();
    store.set("a", section(true));

    const listener = vi.fn();
    store.subscribe(listener);

    for (let i = 0; i < 20; i++) store.set("a", section(true));

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the snapshot stable regardless of registration order", () => {
    // `useSyncExternalStore` re-renders on identity change, so an unordered
    // join would make the bar re-render whenever two sections happened to
    // register in a different order.
    const first = createStore();
    first.set("b", section(true));
    first.set("a", section(true));

    const second = createStore();
    second.set("a", section(true));
    second.set("b", section(true));

    expect(first.getSnapshot()).toBe(second.getSnapshot());
  });

  it("forgets a section that unmounts", () => {
    const store = createStore();
    store.set("a", section(true));
    const listener = vi.fn();
    store.subscribe(listener);

    store.remove("a");

    expect(store.getSnapshot()).toBe("");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("counts each dirty section once, whatever it is called", () => {
    const store = createStore();
    store.set("details", section(true, "פרטי העסק"));
    store.set("social", section(true, "רשתות חברתיות"));
    store.set("deposit", section(false, "מקדמה"));

    expect(store.getSnapshot().split(",")).toEqual(["details", "social"]);
    expect(store.dirtySections().map((s) => s.label)).toEqual([
      "פרטי העסק",
      "רשתות חברתיות",
    ]);
  });

  it("drops a section back out when it is saved", () => {
    const store = createStore();
    store.set("a", section(true));
    store.set("a", section(false));

    expect(store.getSnapshot()).toBe("");
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set("a", section(true));

    expect(listener).not.toHaveBeenCalled();
  });
});
