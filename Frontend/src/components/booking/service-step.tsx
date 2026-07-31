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
        className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100"
      >
        בחרו שירות
      </h2>

      <ul className="space-y-3">
        {services.map((service) => (
          <li key={service.id}>
            <button
              type="button"
              onClick={() => onSelect(service)}
              aria-pressed={selectedId === service.id}
              className={cn(
                "group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start transition-all",
                "focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99]",
                "dark:bg-neutral-900",
                selectedId === service.id
                  ? "border-neutral-900 ring-1 ring-neutral-900 dark:border-neutral-100 dark:ring-neutral-100"
                  : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800",
              )}
            >
              {service.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
                <img
                  src={service.imageUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-xl object-cover"
                />
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-neutral-900 dark:text-neutral-100">
                  {service.name}
                </span>
                {service.description ? (
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">
                    {service.description}
                  </span>
                ) : null}
                <span className="mt-1.5 flex items-center gap-3 text-xs text-neutral-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden />
                    {formatDuration(service.durationMin)}
                  </span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-200">
                    {formatPrice(service.priceCents, service.currency)}
                  </span>
                </span>
              </span>

              <ChevronLeft
                className="size-5 shrink-0 text-neutral-300 transition-transform group-hover:-translate-x-0.5 rtl:rotate-0"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
