"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarX2,
  Clock,
  Loader2,
  Search,
  Tag,
  User,
} from "lucide-react";

import { cancelBookingAction } from "@/app/b/[token]/actions";
import {
  lookupMyAppointmentsAction,
  type LookupResult,
  type MyAppointment,
} from "@/app/[slug]/my-appointments/actions";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; className: string }> = {
  confirmed: {
    label: "מאושר",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  pending: {
    label: "ממתין לאישור",
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  cancelled: {
    label: "בוטל",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  },
  completed: {
    label: "הושלם",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  no_show: {
    label: "לא הגיע",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
  pending_deposit: {
    label: "ממתין לתשלום",
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  pending_approval: {
    label: "ממתין לאישור",
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
};

/**
 * "התורים שלי" — a client's own history at one business, found by phone.
 *
 * The phone goes in a Server Action body rather than the URL. A query string
 * survives in browser history, in referrer headers and in server logs, and this
 * one identifies a person; the page is also then not shareable by accident.
 *
 * Cancellation reuses `cancelBookingAction` with the token the lookup returned,
 * so the window rules are enforced by exactly the code the emailed link uses —
 * there is no second implementation of "may this still be cancelled" to drift.
 */
export function MyAppointments({
  slug,
  businessName,
}: {
  slug: string;
  businessName: string;
}) {
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<LookupResult>();
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setResult(await lookupMyAppointmentsAction(slug, phone));
    });
  }

  /** Re-runs the lookup so a cancelled row re-renders with its real status. */
  function refresh() {
    startTransition(async () => {
      setResult(await lookupMyAppointmentsAction(slug, phone));
    });
  }

  const found = result?.ok ? result : null;
  const empty = found && found.upcoming.length === 0 && found.past.length === 0;

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-8">
      <Link
        href={`/${slug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowRight className="size-4" aria-hidden />
        חזרה ל{businessName}
      </Link>

      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        התורים שלי
      </h1>
      <p className="mt-1 mb-6 text-sm leading-relaxed text-zinc-500">
        הזינו את מספר הטלפון שאיתו קבעתם, ונציג את התורים שלכם ב{businessName}.
      </p>

      <form onSubmit={submit} noValidate className="flex gap-2">
        <label htmlFor="lookup-phone" className="sr-only">
          מספר טלפון
        </label>
        {/* No `name` attribute, deliberately. If the page has not hydrated yet
            — a slow phone, the first tap — the browser submits this form
            natively, and a named field would put the phone number straight into
            the URL, the browser history and the server log. Unnamed, that
            submit is a bare reload with an empty query string. Verified in the
            dev server log: `GET /demo-barber/my-appointments?`. */}
        <input
          id="lookup-phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          placeholder="050-1234567"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-start text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:ring-2 focus:ring-(--accent) focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-(--accent) px-5 text-sm font-semibold text-(--accent-contrast) transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          חיפוש
        </button>
      </form>

      {result && !result.ok ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {result.error}
        </p>
      ) : null}

      {empty ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 px-5 py-12 text-center dark:border-zinc-700">
          <CalendarX2
            className="mx-auto mb-2 size-6 text-zinc-400"
            aria-hidden
          />
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            לא מצאנו תורים למספר הזה
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
            ייתכן שקבעתם עם מספר אחר. אפשר לקבוע תור חדש בעמוד ההזמנות.
          </p>
          <Link
            href={`/${slug}`}
            className="mt-4 inline-flex h-11 items-center rounded-full bg-(--accent) px-5 text-sm font-semibold text-(--accent-contrast)"
          >
            קביעת תור
          </Link>
        </div>
      ) : null}

      {found && !empty ? (
        <div className="mt-6 space-y-8">
          {found.upcoming.length > 0 ? (
            <Section title="תורים קרובים">
              {found.upcoming.map((appointment) => (
                <Card
                  key={appointment.id}
                  appointment={appointment}
                  cancelWindowHours={found.cancelWindowHours}
                  onCancelled={refresh}
                />
              ))}
            </Section>
          ) : null}

          {found.past.length > 0 ? (
            <Section title="היסטוריה">
              {found.past.map((appointment) => (
                <Card
                  key={appointment.id}
                  appointment={appointment}
                  cancelWindowHours={found.cancelWindowHours}
                  onCancelled={refresh}
                />
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

function Card({
  appointment,
  cancelWindowHours,
  onCancelled,
}: {
  appointment: MyAppointment;
  cancelWindowHours: number;
  onCancelled: () => void;
}) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const status = STATUS[appointment.status] ?? STATUS.confirmed;
  const dimmed =
    appointment.isPast ||
    appointment.status === "cancelled" ||
    appointment.status === "no_show";

  function cancel() {
    setError(undefined);
    startTransition(async () => {
      // The same action the emailed link calls, with the same token. The
      // cancellation window is enforced there, not here.
      const result = await cancelBookingAction(appointment.cancelToken);
      if (result.ok) onCancelled();
      else setError(result.error);
    });
  }

  return (
    <li
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900",
        dimmed && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            יום {appointment.weekday}, {appointment.date}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-lg font-bold text-zinc-900 tabular-nums dark:text-zinc-50">
            <Clock className="size-4 text-zinc-400" aria-hidden />
            {appointment.time}
          </p>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            status.className,
          )}
        >
          {status.label}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <dt className="sr-only">שירות</dt>
          <Tag className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
          <dd>
            {appointment.serviceName} · {formatPrice(appointment.priceCents)}
          </dd>
        </div>
        {appointment.staffName ? (
          <div className="flex items-center gap-2">
            <dt className="sr-only">נותן השירות</dt>
            <User className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
            <dd>{appointment.staffName}</dd>
          </div>
        ) : null}
      </dl>

      {error ? (
        <p role="alert" className="mt-3 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      {appointment.canCancel ? (
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full border border-red-200 px-4 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          ביטול התור
        </button>
      ) : null}

      {/* Said out loud rather than left as a missing button: a client staring
          at a booking with no way to cancel it needs to know the shop's rule,
          not to conclude the page is broken. */}
      {!appointment.canCancel &&
      !appointment.isPast &&
      appointment.status !== "cancelled" ? (
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          לא ניתן לבטל פחות מ-{cancelWindowHours} שעות לפני התור. צרו קשר עם
          העסק.
        </p>
      ) : null}
    </li>
  );
}
