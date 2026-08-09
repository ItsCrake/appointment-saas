import { Hourglass } from "lucide-react";

import { AgendaList, type AgendaAppointment } from "./agenda-list";

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
 */
export function PendingRequests({
  appointments,
  timezone,
}: {
  appointments: AgendaAppointment[];
  timezone: string;
}) {
  if (appointments.length === 0) return null;

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
            {appointments.length === 1
              ? "בקשה אחת ממתינה לאישורכם"
              : `${appointments.length} בקשות ממתינות לאישורכם`}
          </h2>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
            המועד שמור ללקוח עד שתחליטו.
          </p>
        </div>
      </div>

      {/* Dates shown, unlike the agenda below — this list spans days. */}
      <AgendaList appointments={appointments} timezone={timezone} showDate />
    </section>
  );
}
