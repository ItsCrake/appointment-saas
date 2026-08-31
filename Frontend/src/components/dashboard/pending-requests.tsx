"use client";

import { Hourglass } from "lucide-react";

import { AgendaList, type AgendaAppointment } from "./agenda-list";
import { useResolvedStatuses } from "./appointment-status-store";

/**
 * Requests waiting on the owner, above the agenda.
 *
 * The agenda shows **one day**; a request can be for any day. Without this an
 * owner would have to navigate to next Tuesday to discover that someone asked
 * for next Tuesday — which they will not do, and the client is left waiting on
 * an answer that never arrives. The whole feature fails on that one gap.
 *
 * Renders nothing at all when there is nothing to answer, so a shop that does
 * not use "תורים באישור" never sees an empty panel explaining a feature they
 * have not turned on.
 *
 * ---------------------------------------------------------------------------
 * **A client component, so that "nothing left to answer" is true on the click
 * rather than on the refetch.** The list and the heading count used to come
 * straight from the server prop, so approving the last request left the panel
 * on screen still saying "בקשה אחת ממתינה לאישורכם" — above an agenda row that
 * had already flipped to approved. The panel disagreeing with the row directly
 * beneath it is what the "delay" actually looked like; the write itself had
 * already returned.
 *
 * The rows themselves are still handed the **server** status: each one resolves
 * its own through the same store, and passing a rewritten status down would be
 * a second copy of the same answer.
 * ---------------------------------------------------------------------------
 */
export function PendingRequests({
  appointments,
  timezone,
}: {
  appointments: AgendaAppointment[];
  timezone: string;
}) {
  const resolved = useResolvedStatuses(appointments);
  const waiting = appointments.filter(
    (_, index) => resolved[index].status === "pending",
  );

  if (waiting.length === 0) return null;

  return (
    <section
      aria-labelledby="pending-requests-heading"
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20"
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"
        >
          <Hourglass className="size-4" />
        </span>
        <div>
          <h2
            id="pending-requests-heading"
            className="text-sm font-bold text-amber-900 dark:text-amber-100"
          >
            {waiting.length === 1
              ? "בקשה אחת ממתינה לאישורכם"
              : `${waiting.length} בקשות ממתינות לאישורכם`}
          </h2>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
            המועד שמור ללקוח עד שתחליטו.
          </p>
        </div>
      </div>

      {/* Dates shown, unlike the agenda below — this list spans days. */}
      <AgendaList appointments={waiting} timezone={timezone} showDate />
    </section>
  );
}
