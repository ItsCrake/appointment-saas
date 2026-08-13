"use client";

import { ArrowRight, CalendarSearch, User } from "lucide-react";

import type { BookingStaff } from "./types";

/**
 * Shown when a team shop has exactly one provider free at the chosen time.
 *
 * The obvious implementation is to skip straight to the details form, and that
 * is what this replaces. Skipping is fine for a one-person shop — there was
 * never a choice — but wrong for a shop with a team: the client came somewhere
 * with several barbers, and being quietly handed the only one left is a
 * decision made *for* them that they cannot see. They cannot tell they were
 * assigned rather than matched, and they cannot tell that a different time
 * would have offered a choice.
 *
 * So it is stated, with both real options in front of them. The cost is one tap
 * on a path that used to have none; the thing it buys is that nobody discovers
 * who they are booked with only when they arrive.
 */
export function OnlyStaffStep({
  staff,
  timeLabel,
  onProceed,
  onChooseAnotherTime,
}: {
  /** The sole provider free at this time. */
  staff: BookingStaff;
  timeLabel: string;
  onProceed: () => void;
  onChooseAnotherTime: () => void;
}) {
  return (
    <section className="px-5">
      <div className="shadow-lift rounded-3xl bg-(--accent-soft) p-5 ring-1 ring-(--accent-soft-border) ring-inset">
        <div className="flex items-center gap-3">
          {staff.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
            <img
              src={staff.imageUrl}
              alt=""
              className="size-11 shrink-0 rounded-full object-cover ring-2 ring-(--accent)"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--accent) text-(--accent-contrast)"
            >
              <User className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-[-0.015em] text-balance text-zinc-900 dark:text-zinc-50">
              בשעה {timeLabel} פנוי/ה רק {staff.name}
            </h2>
            {staff.title ? (
              <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                {staff.title}
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          אפשר להמשיך עם {staff.name}, או לבחור מועד אחר שבו ייתכן שיהיו פנויים
          נותני שירות נוספים.
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={onProceed}
          className="shadow-accent flex h-14 w-full items-center justify-center gap-2 rounded-full bg-(--accent) text-[15px] font-semibold text-(--accent-contrast) transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-(--accent-strong) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99]"
        >
          להמשיך עם {staff.name}
          <ArrowRight className="size-4 rotate-180" aria-hidden />
        </button>

        <button
          type="button"
          onClick={onChooseAnotherTime}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-zinc-800 ring-1 ring-zinc-900/12 transition-colors ring-inset hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-zinc-800"
        >
          <CalendarSearch className="size-4" aria-hidden />
          בחירת מועד אחר
        </button>
      </div>
    </section>
  );
}
