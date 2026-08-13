"use client";

import { Check, User } from "lucide-react";

import { cn } from "@/lib/utils";

import type { BookingStaff } from "./types";

/**
 * Who performs the service, asked **after** the time is chosen.
 *
 * That order is what keeps the flow short. Asking first would mean filtering
 * the calendar by a person the client has no opinion about, and hiding times
 * that were available from someone else. Asking after means step 2 shows every
 * time anyone can do, and this list is only ever the people genuinely free at
 * the one time already picked — which is why it is derived from the slot's own
 * `staffIds` rather than from the roster.
 *
 * **Nothing is preselected.** A preselected name is the failure mode worth
 * avoiding: a client who does not read carefully books a specific person
 * without meaning to, and the shop discovers it when that person is double-
 * committed in spirit if not in the calendar. One deliberate tap is cheap.
 *
 * **There is no "מי שפנוי ראשון" option**, and its absence is deliberate. It
 * made sense when the question came before the time — "whoever is free" is a
 * real preference about a *day*. Once the time is already fixed, every name on
 * this list is free at it, so the option only asked the client to defer a
 * choice they had already been given, and produced a booking nobody had
 * decided.
 */
export function StaffStep({
  staff,
  timeLabel,
  selectedId,
  onSelect,
}: {
  /** Only those free at the chosen time, in the tenant's display order. */
  staff: BookingStaff[];
  /** "09:30", for the heading — the choice only makes sense beside the time. */
  timeLabel: string;
  /** `undefined` until one is tapped; there is no "anyone" value. */
  selectedId: string | undefined;
  onSelect: (staffId: string) => void;
}) {
  return (
    <section className="px-5">
      <h2 className="text-[17px] font-bold tracking-[-0.015em] text-zinc-900 dark:text-zinc-50">
        עם מי בשעה {timeLabel}?
      </h2>
      <p className="mt-1 mb-5 text-sm text-zinc-500">
        {staff.length} נותני שירות פנויים במועד הזה.
      </p>

      <ul className="space-y-2">
        {staff.map((member) => (
          <li key={member.id}>
            <Option
              selected={selectedId === member.id}
              onSelect={() => onSelect(member.id)}
              icon={<User className="size-4" aria-hidden />}
              imageUrl={member.imageUrl}
              title={member.name}
              subtitle={member.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Option({
  selected,
  onSelect,
  icon,
  imageUrl,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  /** A portrait replaces the icon entirely when the owner uploaded one. */
  imageUrl?: string | null;
  title: string;
  subtitle?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-2xl p-4 text-start",
        "ring-1 ring-inset",
        "transition-[background-color,box-shadow,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99]",
        "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none",
        selected
          ? "shadow-accent bg-(--accent-soft) ring-(--accent)"
          : "shadow-lift hover:shadow-raise bg-white ring-zinc-900/8 hover:ring-(--accent) dark:bg-zinc-900 dark:ring-white/10",
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
        <img
          src={imageUrl}
          alt=""
          className={cn(
            "size-11 shrink-0 rounded-full object-cover",
            // Ringed rather than filled when selected: the photo is the point,
            // and tinting it would be the one place the accent covers content
            // instead of marking it.
            selected
              ? "ring-2 ring-(--accent)"
              : "ring-1 ring-black/5 dark:ring-white/10",
          )}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            selected
              ? "bg-(--accent) text-(--accent-contrast)"
              : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-900/5 ring-inset dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10",
          )}
        >
          {icon}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate text-xs text-zinc-500">
            {subtitle}
          </span>
        ) : null}
      </span>

      {selected ? (
        <Check
          className="size-4 shrink-0 text-(--accent-on-soft)"
          aria-hidden
        />
      ) : null}
    </button>
  );
}
