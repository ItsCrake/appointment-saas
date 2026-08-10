import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

/**
 * The PWA surface, checked mechanically.
 *
 * Everything here fails **silently** in production if it drifts: a manifest
 * pointing at a missing icon does not error, it just stops offering an install;
 * a service worker that caches serves yesterday's calendar with no warning at
 * all. None of it shows up in a typecheck, and none of it is something anyone
 * notices until an owner says the app "doesn't install".
 */

const PUBLIC = path.resolve(process.cwd(), "public");
const sw = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

describe("web app manifest", () => {
  const value = manifest();

  it("opens on the dashboard, not the marketing page", () => {
    // Whoever installs this is an owner — a client books once from a link and
    // never installs anything. Landing them on `/` would be the app opening on
    // an advert for itself.
    expect(value.start_url).toBe("/dashboard");
  });

  it("is installable: standalone, scoped, named", () => {
    expect(value.display).toBe("standalone");
    expect(value.scope).toBe("/");
    expect(value.name).toBeTruthy();
    expect(value.short_name).toBeTruthy();
  });

  it("declares Hebrew and RTL, so the install prompt is not mirrored", () => {
    expect(value.lang).toBe("he");
    expect(value.dir).toBe("rtl");
  });

  it("ships both an `any` and a `maskable` icon", () => {
    // Android crops to whatever shape the launcher uses. One `any` icon gets
    // its corners cut off; one `maskable` icon floats small inside the tile.
    const purposes = (value.icons ?? []).map((icon) => icon.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("references icons that actually exist and are not empty", () => {
    // A manifest pointing at a missing file does not error — it silently
    // stops offering the install.
    for (const icon of value.icons ?? []) {
      const file = path.join(PUBLIC, icon.src.replace(/^\//, ""));
      expect(existsSync(file), `${icon.src} is missing`).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(500);
    }
  });

  it("has an apple-touch icon, which is what iOS uses for the home screen", () => {
    // iOS ignores the manifest's icons entirely for "Add to Home Screen".
    expect(
      existsSync(path.resolve(process.cwd(), "src/app/apple-icon.png")),
    ).toBe(true);
  });
});

describe("service worker", () => {
  it("handles push and notification clicks", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
  });

  it("caches nothing", () => {
    // A caching worker is a second, slower deploy pipeline, and for a booking
    // app stale is worse than offline: an owner who sees "no connection"
    // retries, and one who sees a cached slot books over it.
    expect(sw).not.toContain("caches.open");
    expect(sw).not.toContain("cache.put");
    expect(sw).not.toContain("cache.addAll");
  });

  it("registers a fetch handler that does not intercept", () => {
    // Chromium wants a fetch handler for installability; responding to it
    // would route every request through the worker for no benefit.
    expect(sw).toContain('addEventListener("fetch"');
    // The call, not the word — the file explains in prose why it does not make
    // this call, and a bare substring check would fail on its own comment.
    expect(sw).not.toContain("respondWith(");
  });

  it("takes over immediately", () => {
    // Without these, a subscription made on this load is handled by an older
    // worker that may not know about pushes at all.
    expect(sw).toContain("skipWaiting");
    expect(sw).toContain("clients.claim");
  });

  it("always shows something for a push", () => {
    // `userVisibleOnly` means the browser shows its own generic notification
    // if we show none, which looks like a bug in the app.
    expect(sw).toContain("showNotification");
  });
});

describe("iOS safe areas", () => {
  /**
   * `viewport-fit=cover` is the switch that makes `env(safe-area-inset-*)`
   * report real values on iOS. Without it they are all `0px`, every inset rule
   * in the codebase quietly does nothing, and the installed app's tab bar sits
   * under the home indicator — while the CSS still *reads* as correct, which is
   * exactly how it survived review the first time.
   *
   * Asserted against the source rather than a render because it is a static
   * export, and because the failure it guards against is deletion.
   */
  const layout = readFileSync(
    path.resolve(process.cwd(), "src/app/layout.tsx"),
    "utf8",
  );
  const globals = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  it("opts the viewport into the unsafe areas", () => {
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
  });

  it("claims the status bar back for the installed app only", () => {
    // In a browser tab the chrome already occupies that space; padding the body
    // there would push the landing hero down by a strip of blank paper.
    expect(globals).toMatch(/@media \(display-mode: standalone\)/);
    expect(globals).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
  });

  it("keeps the bottom bar clear of the home indicator", () => {
    const nav = readFileSync(
      path.resolve(process.cwd(), "src/components/dashboard/dashboard-nav.tsx"),
      "utf8",
    );
    expect(nav).toContain("pb-[max(env(safe-area-inset-bottom),0.25rem)]");
  });

  it("scrolls dashboard content past the bar rather than under it", () => {
    const dashboardLayout = readFileSync(
      path.resolve(process.cwd(), "src/app/dashboard/layout.tsx"),
      "utf8",
    );
    // 6rem alone cleared the 4rem of tabs but not the inset beneath them.
    expect(dashboardLayout).toContain("env(safe-area-inset-bottom)");
  });
});
