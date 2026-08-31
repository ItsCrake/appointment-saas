"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * One optimistic answer to "what is this appointment's status", shared by every
 * component showing it.
 *
 * ---------------------------------------------------------------------------
 * **The same appointment is on this page twice.** A request for today appears
 * in `PendingRequests` — which spans days, because a request can be for any
 * day — *and* in the agenda for that day directly below it. Each row held its
 * own `useState(appointment.status)`, so approving one left the other showing
 * `pending`, with a live "אישור התור" button on a booking that had already been
 * approved. Pressing it a second time was a real request against a real
 * appointment.
 *
 * The panel heading counted from the server prop, so "בקשה אחת ממתינה" also
 * stayed until a refetch landed — the "delay" was never the write, which
 * returned immediately. It was three components disagreeing while they waited
 * for the server to tell them something two of them already knew.
 *
 * **The override is derived against a baseline, not reconciled in an effect.**
 * An override records the server value it was made against. It applies only
 * while the server still reports that value, which means it expires by being
 * *read*, with no `setState` in an effect and so no cascading render — and it
 * expires correctly in the case a reconciling effect got wrong: a change made
 * from another device arrives as a third value, the baseline stops matching,
 * and the server's answer wins immediately instead of being masked by a local
 * one that is no longer news.
 *
 * A superseded entry stays in the map, inert, until that row is acted on again.
 * The map is keyed by appointment and only ever holds rows the owner has
 * touched this session, so it is bounded by clicks rather than by data.
 *
 * **Works without a provider.** `AgendaList` renders in places that have no
 * store around them, and a shared-state refactor that turns those into a crash
 * is a worse bug than the one being fixed — so the hook falls back to exactly
 * the local state it used to hold.
 * ---------------------------------------------------------------------------
 */
type Override = {
  /** What the owner just chose. */
  status: string;
  /** What the server said when they chose it. The override dies when this does. */
  baseline: string;
};

type Store = {
  get: (id: string) => Override | null;
  set: (id: string, next: Override | null) => void;
};

const StatusContext = createContext<Store | null>(null);

/**
 * The one place the baseline rule is applied.
 *
 * Exported for its own test: it is the whole correctness of this module — when
 * a local answer wins and when it stops winning — and it is the part that
 * cannot be checked by looking at the screen, because the case that matters
 * (a change arriving from somewhere else) needs a second device to reproduce
 * by hand.
 */
export function resolveStatus(
  override: Override | null,
  serverStatus: string,
): string {
  if (!override) return serverStatus;
  return override.baseline === serverStatus ? override.status : serverStatus;
}

export function AppointmentStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const get = useCallback((id: string) => overrides[id] ?? null, [overrides]);

  const set = useCallback((id: string, next: Override | null) => {
    setOverrides((prev) => {
      if (next === null) {
        if (!(id in prev)) return prev; // no re-render for a no-op clear
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      const held = prev[id];
      if (
        held &&
        held.status === next.status &&
        held.baseline === next.baseline
      )
        return prev;
      return { ...prev, [id]: next };
    });
  }, []);

  const value = useMemo(() => ({ get, set }), [get, set]);

  return (
    <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
  );
}

/**
 * This appointment's status, and the setter that changes it everywhere at once.
 *
 * `serverStatus` is the prop from the last server render, and it wins again as
 * soon as it differs from the value the override was made against.
 */
export function useSharedStatus(id: string, serverStatus: string) {
  const store = useContext(StatusContext);
  const [local, setLocal] = useState<Override | null>(null);

  const override = store ? store.get(id) : local;

  const set = useCallback(
    (next: string | null) => {
      const entry =
        next === null ? null : { status: next, baseline: serverStatus };
      if (store) store.set(id, entry);
      else setLocal(entry);
    },
    [store, id, serverStatus],
  );

  return [resolveStatus(override, serverStatus), set] as const;
}

/**
 * Resolves a list of server rows through the store.
 *
 * For the panels that decide whether to render at all from the *count* of
 * something — `PendingRequests` disappears when its last request is answered,
 * and its heading has to stop saying "one waiting" on the same click.
 */
export function useResolvedStatuses<T extends { id: string; status: string }>(
  rows: readonly T[],
): T[] {
  const store = useContext(StatusContext);

  return useMemo(
    () =>
      rows.map((row) => {
        const status = resolveStatus(store?.get(row.id) ?? null, row.status);
        return status === row.status ? row : { ...row, status };
      }),
    [rows, store],
  );
}
