"use client";

import { useSyncExternalStore } from "react";

/** Nothing ever changes, so the subscription is a no-op. */
const subscribe = () => () => {};

/**
 * True once hydrated, false during SSR.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: it is built for
 * a value the server cannot know, takes an explicit server snapshot, and does
 * not set state inside an effect — which the lint config rejects, correctly,
 * because it triggers a second render pass on every mount.
 *
 * Anything reading `localStorage` needs this. Reading it during SSR throws,
 * and rendering the client answer on the server produces a hydration mismatch.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
