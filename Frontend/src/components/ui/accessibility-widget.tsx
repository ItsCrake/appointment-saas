"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Accessibility, X } from "lucide-react";

import { useDraggableCorner } from "@/lib/use-draggable-corner";
import { useIsClient } from "@/lib/use-is-client";

const STORAGE_KEY = "bazman.a11y";
const POSITION_KEY = "bazman.a11y.position";

/** Matches `size-11` on the trigger; the drag hook clamps against it. */
const TRIGGER_SIZE_PX = 44;

type Prefs = {
  /** Root font scale. Everything is sized in rem, so this scales the page. */
  textScale: number;
  highContrast: boolean;
  stopMotion: boolean;
};

const DEFAULTS: Prefs = {
  textScale: 1,
  highContrast: false,
  stopMotion: false,
};

/**
 * Accessibility toggles, as required alongside the Israeli accessibility
 * statement.
 *
 * Deliberately small. The three controls here are the ones that change what a
 * person can actually do — read the text, see the contrast, stop the movement.
 * The overlay widgets that bolt on a screen-reader emulator and a dyslexia
 * font are widely criticised for interfering with the real assistive software
 * a user already has, so this stays out of that territory.
 *
 * Preferences apply as attributes on `<html>` and are read by `globals.css`.
 * They persist per browser and are never sent to the server: a record of who
 * needs high contrast is health-adjacent information we have no reason to hold.
 */
function storedPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) }
      : DEFAULTS;
  } catch {
    // Corrupt or unavailable storage falls back to the defaults.
    return DEFAULTS;
  }
}

export function AccessibilityWidget() {
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  /** Null until the reader touches a control; the stored value rules until then. */
  const [chosen, setChosen] = useState<Prefs | null>(null);

  // Read once per hydration rather than in an effect, so restoring a saved
  // preference does not cost an extra render pass on every page.
  const saved = useMemo(
    () => (isClient ? storedPrefs() : DEFAULTS),
    [isClient],
  );
  const prefs = chosen ?? saved;

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize =
      prefs.textScale === 1 ? "" : `${prefs.textScale * 100}%`;
    root.toggleAttribute("data-a11y-contrast", prefs.highContrast);
    root.toggleAttribute("data-a11y-still", prefs.stopMotion);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Preferences still apply for this session.
    }
  }, [prefs]);

  const set = (patch: Partial<Prefs>) =>
    setChosen((current) => ({ ...(current ?? saved), ...patch }));

  const drag = useDraggableCorner(POSITION_KEY, TRIGGER_SIZE_PX);

  // Only once a position has been chosen does the button leave its CSS corner.
  // Rendering `left/top` from the first paint would need the value during SSR,
  // where there is no viewport to clamp against.
  const placed = drag.position
    ? { left: drag.position.x, top: drag.position.y }
    : undefined;

  return (
    <>
      <button
        type="button"
        {...drag.handlers}
        onClick={() => {
          // A drag ends with a click on the same element. Without this the
          // panel would open every time the button was moved.
          if (drag.wasDragged()) return;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label="אפשרויות נגישות — אפשר לגרור למקום אחר"
        title="אפשרויות נגישות (אפשר לגרור)"
        style={placed}
        className={`fixed z-50 flex size-11 touch-none items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 shadow-lg focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
          drag.dragging
            ? "cursor-grabbing opacity-90"
            : "cursor-grab transition-colors hover:bg-zinc-50"
        } ${
          // Default corner only while nothing has been chosen. `bottom-20`
          // under `md` clears the 64px mobile tab bar, which is the collision
          // that made this draggable in the first place; the desktop sidebar
          // occupies no bottom edge, so it can sit lower there.
          placed ? "" : "start-3 bottom-20 md:bottom-3"
        }`}
      >
        <Accessibility className="size-5" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="אפשרויות נגישות"
          // Anchored to the button when it has been moved, so the panel follows
          // it instead of opening across the screen from it. `bottom` is
          // computed from the viewport height because the panel opens upward.
          style={
            drag.position
              ? {
                  left: Math.min(
                    drag.position.x,
                    Math.max(window.innerWidth - 272, 12),
                  ),
                  bottom: Math.max(
                    window.innerHeight - drag.position.y + 8,
                    12,
                  ),
                }
              : undefined
          }
          className={`fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 ${
            drag.position ? "" : "start-3 bottom-32 md:bottom-16"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              נגישות
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="סגירה"
              className="rounded-lg p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="size-4" />
            </button>
          </div>

          <fieldset className="mb-3">
            <legend className="mb-1.5 text-xs text-zinc-500">גודל טקסט</legend>
            <div className="flex gap-1.5">
              {([1, 1.15, 1.3] as const).map((scale, i) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => set({ textScale: scale })}
                  aria-pressed={prefs.textScale === scale}
                  className={`h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors ${
                    prefs.textScale === scale
                      ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                      : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {["רגיל", "גדול", "ענק"][i]}
                </button>
              ))}
            </div>
          </fieldset>

          <Toggle
            label="ניגודיות גבוהה"
            checked={prefs.highContrast}
            onChange={(v) => set({ highContrast: v })}
          />
          <Toggle
            label="עצירת אנימציות"
            checked={prefs.stopMotion}
            onChange={(v) => set({ stopMotion: v })}
          />

          {/* Resets the position too. A handle dragged somewhere awkward is
              otherwise only fixable by dragging it back, which is the harder
              gesture on the smaller screen where it matters most. */}
          <button
            type="button"
            onClick={() => {
              setChosen(DEFAULTS);
              drag.reset();
            }}
            className="mt-3 w-full rounded-lg border border-zinc-300 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            איפוס הגדרות ומיקום
          </button>

          <Link
            href="/accessibility"
            className="mt-3 block text-center text-[11px] text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            הצהרת נגישות
          </Link>
        </div>
      ) : null}
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 text-xs text-zinc-700 dark:text-zinc-300">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-zinc-900 dark:accent-zinc-100"
      />
    </label>
  );
}
