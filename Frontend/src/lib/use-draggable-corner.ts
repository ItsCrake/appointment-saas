"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useIsClient } from "./use-is-client";

export type Point = { x: number; y: number };

/** Below this much movement a pointer gesture is still a tap, not a drag. */
const DRAG_THRESHOLD_PX = 8;

/** Keeps the handle fully on screen with a little breathing room. */
const EDGE_GAP_PX = 12;

function clampToViewport(point: Point, size: number): Point {
  if (typeof window === "undefined") return point;
  return {
    x: Math.min(
      Math.max(point.x, EDGE_GAP_PX),
      Math.max(window.innerWidth - size - EDGE_GAP_PX, EDGE_GAP_PX),
    ),
    y: Math.min(
      Math.max(point.y, EDGE_GAP_PX),
      Math.max(window.innerHeight - size - EDGE_GAP_PX, EDGE_GAP_PX),
    ),
  };
}

function readStored(storageKey: string): Point | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Point>;
    if (typeof saved.x !== "number" || typeof saved.y !== "number") return null;
    return { x: saved.x, y: saved.y };
  } catch {
    // Corrupt or unavailable storage: stay at the default corner.
    return null;
  }
}

/** Explicitly back to the CSS default, as distinct from "never moved". */
const DEFAULT_POSITION = "default";

/**
 * Makes a fixed-position handle draggable, and remembers where it was put.
 *
 * Written for the accessibility button, which is pinned to a corner that the
 * mobile bottom navigation also occupies — so on a phone it sat on top of the
 * tab bar and covered a control the owner needs. A fixed element cannot know
 * what is underneath it, and every corner is the wrong corner on some screen,
 * so the answer is to let the reader move it.
 *
 * Four details carry the weight:
 *
 * - **A drag must not fire the click.** The handle is a button; without a
 *   movement threshold, every attempt to move it would also open the panel.
 *   `wasDragged` lets the caller decide, rather than this hook swallowing the
 *   activation and breaking the keyboard path along with it.
 * - **Pointer events, not mouse events**, so touch works without a second code
 *   path. Pointer capture keeps the gesture alive when the finger outruns the
 *   button.
 * - **The stored position is read through `useMemo`, not in an effect**, the
 *   same way `AccessibilityWidget` reads its preferences: an effect that calls
 *   `setState` on mount costs an extra render pass on every page and is what
 *   the `set-state-in-effect` rule exists to catch.
 * - **Clamping happens on read, every render.** A position saved on a desktop
 *   window would otherwise put the handle off-screen on a phone, where it
 *   becomes unreachable *and* unmovable — a worse failure than the one this
 *   exists to fix.
 */
export function useDraggableCorner(storageKey: string, size: number) {
  const isClient = useIsClient();
  const [chosen, setChosen] = useState<Point | typeof DEFAULT_POSITION | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  // Bumped on resize so the clamp below re-runs. Set from an event callback
  // rather than an effect body, which is the distinction the lint rule draws.
  const [viewportTick, setViewportTick] = useState(0);

  const origin = useRef<{ pointer: Point; start: Point } | null>(null);
  const moved = useRef(false);

  const stored = useMemo(
    () => (isClient ? readStored(storageKey) : null),
    [isClient, storageKey],
  );

  const raw = chosen === DEFAULT_POSITION ? null : (chosen ?? stored);

  const position = useMemo(
    () => (raw && isClient ? clampToViewport(raw, size) : null),
    // viewportTick is the dependency that matters here: the clamp reads the
    // live window size, which React cannot see change on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, isClient, size, viewportTick],
  );

  useEffect(() => {
    const onResize = () => setViewportTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Let the browser handle right-click and any modified click normally.
      if (event.button !== 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      origin.current = {
        pointer: { x: event.clientX, y: event.clientY },
        start: { x: rect.left, y: rect.top },
      };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const from = origin.current;
      if (!from) return;

      const dx = event.clientX - from.pointer.x;
      const dy = event.clientY - from.pointer.y;

      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      moved.current = true;
      setDragging(true);
      setChosen(
        clampToViewport({ x: from.start.x + dx, y: from.start.y + dy }, size),
      );
    },
    [size],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!origin.current) return;
      origin.current = null;
      setDragging(false);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (!moved.current) return;

      try {
        const rect = event.currentTarget.getBoundingClientRect();
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ x: rect.left, y: rect.top }),
        );
      } catch {
        // The move still applies for this session.
      }
    },
    [storageKey],
  );

  /** True for the click immediately following a drag, so it can be ignored. */
  const wasDragged = useCallback(() => moved.current, []);

  const reset = useCallback(() => {
    setChosen(DEFAULT_POSITION);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up.
    }
  }, [storageKey]);

  return {
    position,
    dragging,
    wasDragged,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
