import { MapPin, Phone } from "lucide-react";

import { HoursDrawer } from "./hours-drawer";
import type { BookingHours } from "./types";

type Props = {
  name: string;
  description: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  hours: BookingHours[];
  /** 0 = Sunday, resolved in the business timezone by the server. */
  todayWeekday: number;
};

/**
 * Server component: nothing here is interactive except the hours sheet, which
 * is the only part that ships JavaScript.
 */
export function BusinessHeader({
  name,
  description,
  logoUrl,
  address,
  phone,
  hours,
  todayWeekday,
}: Props) {
  return (
    <header className="px-5 pt-8 pb-6 text-center">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote host is per-tenant and not known at build time
        <img
          src={logoUrl}
          alt=""
          className="mx-auto mb-4 size-20 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10"
        />
      ) : (
        <div
          aria-hidden
          className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-neutral-800 to-neutral-950 text-2xl font-bold text-white shadow-sm dark:from-neutral-100 dark:to-neutral-300 dark:text-neutral-900"
        >
          {name.trim().charAt(0)}
        </div>
      )}

      <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
        {name}
      </h1>

      {description ? (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          {description}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-neutral-500">
        {address ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {address}
          </span>
        ) : null}

        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Phone className="size-3.5 shrink-0" aria-hidden />
            <span dir="ltr">{phone}</span>
          </a>
        ) : null}

        <HoursDrawer hours={hours} todayWeekday={todayWeekday} />
      </div>
    </header>
  );
}
