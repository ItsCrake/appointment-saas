"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertCircle, Loader2, Undo2 } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { btnPrimary } from "./ui";

/**
 * One save bar for a page made of five independent forms.
 *
 * ---------------------------------------------------------------------------
 * The settings page grew a Save button per section — business details,
 * appearance, logo, social links, deposits — each with its own action and its
 * own idea of when it had been pressed. An owner who changed three things had
 * to find three buttons, and the one they missed simply did not save. Nothing
 * on the page ever said which was which.
 *
 * So: sections **register themselves** here, the bar appears only when at least
 * one of them differs from what was last saved, and pressing save runs every
 * dirty section's own action. Each section keeps its own validation, its own
 * error message and its own server action — this coordinates them, it does not
 * absorb them.
 *
 * `useSyncExternalStore` rather than context state, because the registry is
 * written from inside child effects. Putting it in state would mean a child
 * setting a parent's state during its own commit, which is the cascading render
 * the lint rule exists to stop — and would re-render every section whenever any
 * one of them became dirty.
 * ---------------------------------------------------------------------------
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

type Section = {
  /** Shown in the failure message, so the owner knows where to look. */
  label: string;
  dirty: boolean;
  save: () => Promise<SaveResult>;
  reset: () => void;
};

type Store = {
  set(id: string, section: Section): void;
  remove(id: string): void;
  subscribe(listener: () => void): () => void;
  /** Stable string of dirty ids — the identity `useSyncExternalStore` needs. */
  getSnapshot(): string;
  dirtySections(): Section[];
};

/** Exported for `settings-dirty.test.ts` — the registry is the subtle part. */
export function createStore(): Store {
  const sections = new Map<string, Section>();
  const listeners = new Set<() => void>();
  let snapshot = "";

  /**
   * Notifies only when the *set of dirty ids* changes. Sections re-register on
   * every render to keep their closures fresh, so without this the bar would
   * re-render on every keystroke in any field on the page.
   */
  function recompute() {
    const next = [...sections.entries()]
      .filter(([, section]) => section.dirty)
      .map(([id]) => id)
      .sort()
      .join(",");

    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    set(id, section) {
      sections.set(id, section);
      recompute();
    },
    remove(id) {
      sections.delete(id);
      recompute();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    dirtySections: () =>
      [...sections.values()].filter((section) => section.dirty),
  };
}

const StoreContext = createContext<Store | null>(null);

export function SettingsDirtyProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = useMemo(() => createStore(), []);
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

function useStore(): Store | null {
  return useContext(StoreContext);
}

/**
 * Values compared as JSON.
 *
 * Sound here because every section's values are built from one object literal,
 * so key order is fixed, and hold only strings, numbers, booleans and arrays of
 * those — no dates, no undefined-vs-missing, no cycles. A structural compare
 * would be more code defending against shapes this page cannot produce.
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The whole contract for a settings section: hold the values, know whether they
 * differ from what was last saved, and expose a way to save and to discard.
 *
 * `baseline` is state rather than the `initial` prop, so a successful save
 * makes the section clean **without a round trip** — waiting for the server
 * data to come back would leave the bar up for a beat after a save that
 * already worked, which reads as a failure.
 */
export function useSectionForm<T>({
  id,
  label,
  initial,
  onSave,
}: {
  id: string;
  label: string;
  initial: T;
  onSave: (values: T) => Promise<SaveResult>;
}) {
  const [values, setValues] = useState<T>(initial);
  const [baseline, setBaseline] = useState<T>(initial);

  const dirty = !same(values, baseline);

  const save = useCallback(async () => {
    const result = await onSave(values);
    if (result.ok) setBaseline(values);
    return result;
  }, [onSave, values]);

  const reset = useCallback(() => setValues(baseline), [baseline]);

  useSection({ id, label, dirty, save, reset });

  return { values, setValues, dirty };
}

/** For a section whose state is too shaped to fit `useSectionForm`. */
export function useSection({
  id,
  label,
  dirty,
  save,
  reset,
}: { id: string } & Section) {
  const store = useStore();

  // Deliberately re-registered whenever any of these change, which in practice
  // is most renders: `save` closes over the current values, and a stale closure
  // here would save what the field held a keystroke ago.
  useEffect(() => {
    store?.set(id, { label, dirty, save, reset });
  }, [store, id, label, dirty, save, reset]);

  // Unregistering is its own effect so it runs on unmount only. Folding it into
  // the one above would remove and re-add on every render, and the bar would
  // flicker through "nothing to save" on every keystroke.
  useEffect(() => () => store?.remove(id), [store, id]);
}

/**
 * The bar. Fixed to the bottom, above the mobile tab bar, and absent entirely
 * until something has actually changed.
 */
export function SettingsSaveBar() {
  const store = useStore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const snapshot = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.getSnapshot ?? (() => ""),
    // Server render: nothing is dirty before the page is interactive, and
    // rendering the bar into the HTML would flash it on every load.
    () => "",
  );

  const count = snapshot === "" ? 0 : snapshot.split(",").length;

  /**
   * The browser's own guard, which is the only thing that survives a closed
   * tab. Registered only while something is unsaved — a page that always warns
   * on leaving is a page people learn to click through.
   */
  useEffect(() => {
    if (count === 0) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  if (!store || count === 0) return null;

  async function saveAll() {
    if (!store) return;
    setSaving(true);

    // Sequential, not Promise.all: these are separate writes to one row, and
    // failing halfway should leave the sections that did save marked clean
    // rather than rolling anything back.
    const failed: string[] = [];
    for (const section of store.dirtySections()) {
      const result = await section.save();
      if (!result.ok) {
        failed.push(section.label);
        toast(`${section.label}: ${result.error}`, "error");
      }
    }

    setSaving(false);
    if (failed.length === 0) toast("ההגדרות נשמרו", "success");
  }

  function discardAll() {
    if (!store) return;
    for (const section of store.dirtySections()) section.reset();
  }

  return (
    <div
      role="region"
      aria-label="שינויים שלא נשמרו"
      // bottom-16 on mobile clears the tab bar; md drops it back to the edge.
      className="animate-sheet fixed inset-x-0 bottom-16 z-30 px-3 pb-3 md:bottom-0 md:px-6 md:pb-4"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <AlertCircle className="size-5 shrink-0 text-amber-400" aria-hidden />

        <p className="min-w-0 flex-1 text-sm font-medium text-white">
          {count === 1 ? "יש שינוי שלא נשמר" : `יש ${count} שינויים שלא נשמרו`}
        </p>

        <button
          type="button"
          onClick={discardAll}
          disabled={saving}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
        >
          <Undo2 className="size-4" aria-hidden />
          ביטול
        </button>

        <button
          type="button"
          onClick={saveAll}
          disabled={saving}
          className={cn(
            btnPrimary,
            "h-10 shrink-0 bg-white px-5 text-zinc-950",
          )}
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              שומר…
            </>
          ) : (
            "שמירת השינויים"
          )}
        </button>
      </div>
    </div>
  );
}
