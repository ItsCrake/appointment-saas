/**
 * Indeterminate bar pinned to the top edge, rendered by every `loading.tsx`.
 *
 * Driven by Suspense rather than by router events: a `loading.tsx` mounts the
 * instant a navigation starts and unmounts when the route's content arrives,
 * which is exactly the window this should be visible for. That means no
 * subscription to router internals, no timers, and no state that can get stuck
 * on after a transition is cancelled.
 *
 * A server component — it ships no JavaScript at all, because the animation is
 * pure CSS and the mount/unmount is the state.
 *
 * `dir="ltr"` because the page is RTL and `translateX` would otherwise run the
 * bar backwards. It is decorative, so direction carries no meaning here.
 */
export function RouteProgress() {
  return (
    <div
      aria-hidden
      dir="ltr"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="route-progress h-full w-1/3 bg-[image:var(--brand-gradient)]" />
    </div>
  );
}
