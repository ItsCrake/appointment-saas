"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, Clock } from "lucide-react";

import { formatDuration, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BookingService } from "./types";

type Props = {
  services: BookingService[];
  selectedId?: string;
  onSelect: (service: BookingService) => void;
};

export function ServiceStep({ services, selectedId, onSelect }: Props) {
  return (
    <section aria-labelledby="service-heading" className="px-5">
      <h2
        id="service-heading"
        className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-100"
      >
        בחרו שירות
      </h2>
      <p className="mt-1 mb-5 text-xs text-zinc-500">
        {services.length} שירותים זמינים להזמנה
      </p>

      <ul className="space-y-3">
        {services.map((service, index) => (
          // Clamped, like every stagger on this page: a catalogue of thirty
          // services would otherwise still be arriving a second later.
          <li
            key={service.id}
            className="animate-rise"
            style={{ "--i": Math.min(index, 6) } as CSSProperties}
          >
            <button
              type="button"
              onClick={() => onSelect(service)}
              aria-pressed={selectedId === service.id}
              className={cn(
                "group flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-start",
                "ring-1 ring-inset",
                /**
                 * The card gains depth on hover and never moves.
                 *
                 * A `hover:-translate-y` here reads well with a mouse and costs
                 * more than it buys: the transition makes the element a moving
                 * target for the ~200ms after a pointer lands on it, and any
                 * click driven by tooling — or by a user whose tap registers as
                 * a hover first — arrives mid-flight. The transition list is
                 * therefore explicit rather than `transition-all`, so the press
                 * scale below applies instantly and settles in the same frame.
                 *
                 * `box-shadow` covers the ring too, since a ring *is* a shadow.
                 */
                "transition-[background-color,box-shadow,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "active:scale-[0.99]",
                "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                "dark:bg-zinc-900",
                selectedId === service.id
                  ? "shadow-accent ring-(--accent)"
                  : "shadow-lift hover:shadow-raise ring-zinc-900/8 hover:ring-(--accent) dark:ring-white/10",
              )}
            >
              {service.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
                <img
                  src={service.imageUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-2xl object-cover ring-1 ring-zinc-900/5 ring-inset"
                />
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
                  {service.name}
                </span>

                {service.description ? (
                  // Two lines rather than one: a service description is the
                  // only place an owner explains what the client is buying.
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-500">
                    {service.description}
                  </span>
                ) : null}

                <span className="mt-2.5 flex items-center gap-2">
                  {/* Tinted, not filled: it is a duration, not an action, and
                      a badge on every row would drown the selected state. */}
                  <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-soft) px-2.5 py-1 text-[11px] font-medium text-(--accent-on-soft)">
                    <Clock className="size-3" aria-hidden />
                    {formatDuration(service.durationMin)}
                  </span>
                  <span className="text-[15px] font-bold tracking-[-0.01em] text-zinc-900 tabular-nums dark:text-zinc-100">
                    {formatPrice(service.priceCents, service.currency)}
                  </span>
                </span>
              </span>

              <ChevronLeft
                className="size-5 shrink-0 text-zinc-300 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-1 dark:text-zinc-600"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
