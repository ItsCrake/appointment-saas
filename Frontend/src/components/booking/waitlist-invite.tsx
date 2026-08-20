"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";

import { claimWaitlistSlotAction } from "@/app/w/[token]/actions";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type InviteState = "open" | "taken" | "booked" | "expired";

/**
 * "A slot opened — do you want it?", and the three other answers.
 *
 * ---------------------------------------------------------------------------
 * **Losing the race is a designed state, not an error.** The same link went to
 * several people, so somebody arriving second is the normal case rather than a
 * failure, and treating it as one — a red alert, a stack trace, a dead end —
 * would punish a client for the shop's own fairness rule. The `taken` screen
 * therefore says what happened, says it was first-come-first-served, and says
 * the thing they actually want to hear: they are still in the queue and still
 * near the front.
 *
 * The offer itself is deliberately a single button. Everything about the
 * appointment was decided when the shop invited them — the time, the provider,
 * the service, the price — so asking them to re-pick any of it would be asking
 * a question whose answer is already fixed, while the slot is being offered to
 * somebody else.
 * ---------------------------------------------------------------------------
 */
export function WaitlistInvite({
  token,
  state: initialState,
  clientName,
  businessName,
  businessSlug,
  timezone,
  serviceName,
  priceCents,
  staffName,
  startsAt,
}: {
  token: string;
  state: InviteState;
  clientName: string;
  businessName: string;
  businessSlug: string;
  timezone: string;
  serviceName: string | null;
  priceCents: number | null;
  staffName: string | null;
  startsAt: string | null;
}) {
  const [state, setState] = useState<InviteState>(initialState);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const when = startsAt ? formatFullDateTime(startsAt, timezone) : null;

  function claim() {
    setError(undefined);
    startTransition(async () => {
      const result = await claimWaitlistSlotAction(token);
      if (result.ok) setState("booked");
      else if (result.taken) setState("taken");
      else setError(result.error);
    });
  }

  return (
    <div className="animate-rise rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/70">
      {state === "booked" ? (
        <Outcome
          tone="good"
          icon={<CheckCircle2 className="size-6" aria-hidden />}
          title="התור נשמר לכם"
          body={`נתראה ב${businessName}. שלחנו לכם אישור.`}
        />
      ) : state === "taken" ? (
        <Outcome
          tone="soft"
          icon={<Sparkles className="size-6" aria-hidden />}
          title="התור הזה כבר נתפס"
          /* The consolation is the true part, and it is the reason to stay:
             they never left the queue, and the next opening reaches them. */
          body="הודענו לכמה ממתינים יחד, ומישהו הספיק לפניכם. אתם עדיין ברשימה — ונקפוץ אתכם לראש התור בביטול הבא."
        />
      ) : state === "expired" ? (
        <Outcome
          tone="soft"
          icon={<Clock className="size-6" aria-hidden />}
          title="ההצעה כבר לא בתוקף"
          body="המועד הזה עבר או שההצעה בוטלה. אתם עדיין ברשימת ההמתנה."
        />
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold text-(--accent-on-soft)">
            <CalendarClock className="size-4" aria-hidden />
            התפנה תור
          </p>

          <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            היי {clientName}, יש מקום ב{businessName}
          </h1>

          {when ? (
            <p className="mt-4 rounded-2xl bg-(--accent-soft) px-4 py-3 text-lg font-bold text-(--accent-on-soft)">
              יום {when.weekday}, {when.date}
              <span className="mx-2 opacity-40">·</span>
              <span className="tabular-nums" dir="ltr">
                {when.time}
              </span>
            </p>
          ) : null}

          <dl className="mt-4 space-y-1.5 text-sm">
            {serviceName ? (
              <Row label="שירות">{serviceName}</Row>
            ) : null}
            {priceCents !== null ? (
              <Row label="מחיר">{formatPrice(priceCents)}</Row>
            ) : null}
            {staffName ? (
              <Row label="נותן שירות">
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="size-3.5 opacity-60" aria-hidden />
                  {staffName}
                </span>
              </Row>
            ) : null}
          </dl>

          {error ? (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={claim}
            disabled={pending}
            className={cn(
              "mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full",
              "bg-(--accent) text-base font-bold text-(--accent-contrast)",
              "transition-all hover:opacity-90 active:translate-y-px disabled:opacity-60",
            )}
          >
            {pending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : null}
            אני רוצה את התור
          </button>

          {/* Said before they tap, not after they lose. Somebody who knows the
              rule reads the "taken" screen as the rule working; somebody who
              does not reads it as the shop going back on its word. */}
          <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
            ההצעה נשלחה לכמה ממתינים — התור נשמר למי שמזמין ראשון.
          </p>
        </>
      )}

      <Link
        href={`/${businessSlug}`}
        className="mt-5 block text-center text-sm font-semibold text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        לעמוד ההזמנות של {businessName}
      </Link>
    </div>
  );
}

function Outcome({
  tone,
  icon,
  title,
  body,
}: {
  tone: "good" | "soft";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="text-center">
      <span
        aria-hidden
        className={cn(
          "mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl",
          tone === "good"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-(--accent-soft) text-(--accent-on-soft)",
        )}
      >
        {icon}
      </span>
      <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {body}
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}
