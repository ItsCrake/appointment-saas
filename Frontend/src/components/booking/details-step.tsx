"use client";

import { useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { AlertCircle, Clock, Loader2, Tag } from "lucide-react";

import { ConsentNote } from "@/components/ui/consent-note";
import type { Slot } from "@/lib/availability";
import { formatDuration, formatFullDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clientDetailsSchema, type ClientDetails } from "@/lib/validation";

import type { BookingService } from "./types";

/**
 * Module scope on purpose: the React compiler flags any impure call written
 * lexically inside a component, even one that only ever runs from an event
 * handler.
 */
function elapsedSince(start: number | null) {
  return start === null ? undefined : Date.now() - start;
}

type Props = {
  service: BookingService;
  slot: Slot;
  timezone: string;
  submitting: boolean;
  serverError?: string;
  /** Epoch ms when the slot was picked; the clock for the human-pace check. */
  startedAt: number | null;
  /**
   * Whether this shop actually runs the win-back campaign. The consent box is
   * rendered only when it does — asking permission to send messages nobody is
   * going to send is a question with no honest purpose, and it adds a line of
   * legal text to a one-minute form for nothing.
   */
  askMarketingConsent: boolean;
  onSubmit: (details: ClientDetails) => void;
};

export function DetailsStep({
  service,
  slot,
  timezone,
  submitting,
  serverError,
  startedAt,
  askMarketingConsent,
  onSubmit,
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientDetails>({
    resolver: standardSchemaResolver(clientDetailsSchema),
    mode: "onTouched",
    defaultValues: {
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      notes: "",
      // Unticked. A pre-ticked consent box is not consent, and it is the
      // single most common way this kind of feature becomes unlawful.
      consentMarketing: false,
    },
  });

  function submitWithTiming(values: ClientDetails) {
    onSubmit({ ...values, elapsedMs: elapsedSince(startedAt) });
  }

  const when = formatFullDateTime(slot.startsAt, timezone);

  return (
    <section aria-labelledby="details-heading" className="px-5">
      <h2
        id="details-heading"
        className="mb-5 text-[17px] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-100"
      >
        הפרטים שלכם
      </h2>

      {/* Summary of what is being booked, so nobody confirms blind. The time is
          the largest thing on the card — it is what people double-check. */}
      <div className="shadow-raise mb-6 overflow-hidden rounded-2xl ring-1 ring-zinc-900/8 ring-inset dark:ring-white/10">
        {/* The one filled surface on the final step, so it carries the shop's
            colour rather than ink. It is a summary of what is about to be
            booked — the most "theirs" thing on the page. */}
        <div className="flex items-center justify-between gap-3 bg-(--accent) px-4 py-3.5 text-(--accent-contrast)">
          <span className="min-w-0 truncate text-sm font-semibold">
            {service.name}
          </span>
          <span className="shrink-0 text-xl leading-none font-bold tracking-[-0.02em] tabular-nums">
            {when.time}
          </span>
        </div>

        <dl className="space-y-2 bg-zinc-50 px-4 py-3.5 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <dt className="sr-only">מועד</dt>
            <Clock className="size-4 shrink-0" aria-hidden />
            <dd>
              יום {when.weekday}, {when.date}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">מחיר ומשך</dt>
            <Tag className="size-4 shrink-0" aria-hidden />
            <dd>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {formatPrice(service.priceCents, service.currency)}
              </span>{" "}
              · {formatDuration(service.durationMin)}
            </dd>
          </div>
        </dl>
      </div>

      <form
        onSubmit={handleSubmit(submitWithTiming)}
        noValidate
        className="relative space-y-5"
      >
        <Field
          label="שם מלא"
          error={errors.clientName?.message}
          htmlFor="clientName"
        >
          <input
            id="clientName"
            type="text"
            autoComplete="name"
            enterKeyHint="next"
            placeholder="ישראל ישראלי"
            aria-invalid={Boolean(errors.clientName)}
            aria-describedby={
              errors.clientName ? "clientName-error" : undefined
            }
            className={inputClass(Boolean(errors.clientName))}
            {...register("clientName")}
          />
        </Field>

        <Field
          label="טלפון נייד"
          error={errors.clientPhone?.message}
          htmlFor="clientPhone"
        >
          <input
            id="clientPhone"
            // `tel` keeps the numeric keypad on mobile without blocking dashes.
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="done"
            dir="ltr"
            placeholder="050-1234567"
            aria-invalid={Boolean(errors.clientPhone)}
            aria-describedby={
              errors.clientPhone ? "clientPhone-error" : undefined
            }
            className={cn(
              inputClass(Boolean(errors.clientPhone)),
              "text-start",
            )}
            {...register("clientPhone")}
          />
        </Field>

        <Field
          label="אימייל (לקבלת אישור ותזכורת)"
          htmlFor="clientEmail"
          error={errors.clientEmail?.message}
        >
          <input
            id="clientEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.clientEmail)}
            aria-describedby={
              errors.clientEmail ? "clientEmail-error" : undefined
            }
            className={cn(
              inputClass(Boolean(errors.clientEmail)),
              "text-start",
            )}
            {...register("clientEmail")}
          />
        </Field>

        <Field
          label="הערות (לא חובה)"
          htmlFor="notes"
          error={errors.notes?.message}
        >
          <textarea
            id="notes"
            rows={2}
            placeholder="משהו שכדאי שנדע?"
            className={cn(inputClass(false), "h-auto resize-none py-3")}
            {...register("notes")}
          />
        </Field>

        {/*
          Honeypot. Positioned off-screen rather than display:none, which is
          the pattern scrapers most commonly detect and skip. aria-hidden and
          tabIndex={-1} keep it away from screen readers and the tab order;
          the unusual name plus autoComplete="off" keeps password managers off
          it.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden"
        >
          <label htmlFor="contact_reference">אל תמלאו שדה זה</label>
          <input
            id="contact_reference"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            {...register("contactReference")}
          />
        </div>

        {serverError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-600/15 ring-inset dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="shadow-accent flex h-14 w-full items-center justify-center gap-2 rounded-full bg-(--accent) text-[15px] font-semibold text-(--accent-contrast) transition-[background-color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-(--accent-strong) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              קובע תור…
            </>
          ) : (
            "אישור וקביעת התור"
          )}
        </button>

        {/* Separated from the implicit consent below on purpose. Messages
            *about this appointment* need no tickbox — there is no ongoing
            relationship and a required checkbox in front of a one-minute flow
            costs completions without adding meaningful consent. A shop
            messaging someone weeks later to drum up business is a different
            thing entirely, and it is opt-in, unticked, and separately worded. */}
        {askMarketingConsent ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-zinc-50/60 px-4 py-3.5 ring-1 ring-zinc-900/8 ring-inset dark:bg-zinc-900/40 dark:ring-white/10">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 text-(--accent) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:border-zinc-700"
              {...register("consentMarketing")}
            />
            <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              אשמח לקבל עדכונים והצעות מהעסק בוואטסאפ. אפשר להסיר בכל רגע.
            </span>
          </label>
        ) : null}

        <div className="space-y-1.5 pb-2 text-center">
          {/* zinc-500, not zinc-400: this is consent copy and it has to be
              legible. zinc-400 on white measures 2.6:1. */}
          <p className="text-xs text-zinc-500">
            בקביעת התור אתם מאשרים קבלת הודעות בנוגע לתור זה.
          </p>
          <ConsentNote action="קביעת תור" />
        </div>
      </form>
    </section>
  );
}

/**
 * `rounded-xl`, not the pill the rest of the page uses on interactive things —
 * the documented departure for text inputs. A pill field wastes its horizontal
 * ends and, in RTL, drops the caret against a curve.
 *
 * The placeholder moved from `zinc-400` to `zinc-500`: at 2.6:1 against white
 * the old value was below the 4.5:1 floor, and a placeholder is text.
 */
function inputClass(invalid: boolean) {
  return cn(
    "h-13 w-full rounded-xl bg-white px-4 text-base text-zinc-900 placeholder:text-zinc-500",
    "ring-1 ring-inset transition-shadow duration-200",
    "focus:outline-none focus:ring-2 focus:ring-(--accent)",
    "dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-100",
    invalid
      ? "ring-red-400 focus:ring-red-500"
      : "shadow-lift ring-zinc-900/8 dark:ring-white/10",
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-[13px] font-semibold text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
