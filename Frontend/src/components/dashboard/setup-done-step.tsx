"use client";

import { PartyPopper } from "lucide-react";

import { BookingLink } from "@/components/dashboard/booking-link";
import { formatDuration, formatPrice } from "@/lib/format";

import type { SetupBusiness } from "./setup-flow";

export function SetupDoneStep({
  business,
  services,
  appUrl,
  pending,
  onFinish,
}: {
  business: SetupBusiness;
  services: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
  }[];
  appUrl: string;
  pending: boolean;
  onFinish: () => void;
}) {
  return (
    <div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
        <div
          aria-hidden
          className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white"
        >
          <PartyPopper className="size-6" />
        </div>
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          {business.name} מוכן לקבל תורים
        </p>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
          שתפו את הקישור הזה עם הלקוחות שלכם
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <BookingLink appUrl={appUrl} slug={business.slug} />
      </div>

      <ul className="mt-4 space-y-1.5 rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {services.map((service) => (
          <li
            key={service.id}
            className="flex items-center justify-between gap-3 text-zinc-700 dark:text-zinc-300"
          >
            <span className="truncate">{service.name}</span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
              {formatDuration(service.durationMin)} ·{" "}
              {formatPrice(service.priceCents)}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onFinish}
        disabled={pending}
        className="mt-5 h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60"
      >
        כניסה ללוח הניהול
      </button>
    </div>
  );
}
