"use client";

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
        className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
      >
        בחרו שירות
      </h2>
      <p className="mt-1 mb-4 text-xs text-neutral-500">
        {services.length} שירותים זמינים להזמנה
      </p>

      <ul className="space-y-3">
        {services.map((service) => (
          <li key={service.id}>
            <button
              type="button"
              onClick={() => onSelect(service)}
              aria-pressed={selectedId === service.id}
              className={cn(
                "group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start",
                "transition-all duration-150 active:scale-[0.99]",
                "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                "dark:bg-neutral-900",
                selectedId === service.id
                  ? "border-(--accent) ring-1 ring-(--accent)"
                  : "border-neutral-200 hover:border-(--accent) hover:shadow-md dark:border-neutral-800",
              )}
            >
              {service.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
                <img
                  src={service.imageUrl}
                  alt=""
                  className="size-16 shrink-0 rounded-xl object-cover"
                />
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-neutral-900 dark:text-neutral-100">
                  {service.name}
                </span>

                {service.description ? (
                  // Two lines rather than one: a service description is the
                  // only place an owner explains what the client is buying.
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-neutral-500">
                    {service.description}
                  </span>
                ) : null}

                <span className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    <Clock className="size-3" aria-hidden />
                    {formatDuration(service.durationMin)}
                  </span>
                  <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                    {formatPrice(service.priceCents, service.currency)}
                  </span>
                </span>
              </span>

              <ChevronLeft
                className="size-5 shrink-0 text-neutral-300 transition-transform duration-150 group-hover:-translate-x-1 dark:text-neutral-600"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
