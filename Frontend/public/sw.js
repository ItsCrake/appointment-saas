/**
 * Service worker.
 *
 * ---------------------------------------------------------------------------
 * IT CACHES NOTHING, AND THAT IS DELIBERATE.
 *
 * A service worker that caches is a second, slower deploy pipeline: it serves
 * whatever it stored until an invalidation strategy nobody tested says
 * otherwise, and the failure mode is a business owner looking at yesterday's
 * calendar while the server has today's. For a booking app, stale is worse than
 * offline — an owner who sees "no connection" retries, and an owner who sees a
 * cached 09:00 slot that has already gone books over it.
 *
 * So this file exists for two things only: making the app installable, and
 * receiving push notifications. Every request passes straight through to the
 * network.
 * ---------------------------------------------------------------------------
 */

// Take over immediately rather than waiting for every tab to close. Without
// these, a push subscription made on this load is handled by an older worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

/**
 * Required for installability in Chromium, and doing nothing is the point:
 * returning `fetch(event.request)` would route every request through the worker
 * for no benefit and one more thing to go wrong. Not calling
 * `event.respondWith` leaves the browser to do exactly what it would have done.
 */
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    // A push that is not our JSON is still worth surfacing rather than
    // dropping: `userVisibleOnly` means the browser will show its own generic
    // notification if we show none, which looks like a bug in the app.
    payload = { title: "בזמן", body: event.data.text() };
  }

  const title = payload.title || "בזמן";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "he",
      dir: "rtl",
      // Collapses repeats: three bookings in a minute should be one line in the
      // shade, not three. A per-appointment tag would stack them.
      tag: payload.tag || "booking",
      renotify: true,
      data: { url: payload.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Focus a tab that is already open rather than opening a second one —
      // an owner tapping three notifications should not end up with three
      // copies of their dashboard.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
