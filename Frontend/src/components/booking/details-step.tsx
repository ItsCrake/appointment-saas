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
  onSubmit: (details: ClientDetails) => void;
};

export function DetailsStep({
  service,
  slot,
  timezone,
  submitting,
  serverError,
  startedAt,
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
        className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100"
      >
        הפרטים שלכם
      </h2>

      {/* Summary of what is being booked, so nobody confirms blind. The time is
          the largest thing on the card — it is what people double-check. */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-3 bg-neutral-900 px-4 py-3 text-white dark:bg-neutral-100 dark:text-neutral-900">
          <span className="min-w-0 truncate text-sm font-semibold">
            {service.name}
          </span>
          <span className="shrink-0 text-lg leading-none font-bold tabular-nums">
            {when.time}
          </span>
        </div>

        <dl className="space-y-1.5 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
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
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
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
        className="relative space-y-4"
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
            className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm font-semibold text-(--accent-contrast) shadow-sm transition-all hover:bg-(--accent-strong) hover:shadow-md focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
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

        <div className="space-y-1.5 pb-2 text-center">
          <p className="text-xs text-neutral-400">
            בקביעת התור אתם מאשרים קבלת הודעות בנוגע לתור זה.
          </p>
          <ConsentNote action="קביעת תור" />
        </div>
      </form>
    </section>
  );
}

function inputClass(invalid: boolean) {
  return cn(
    "h-12 w-full rounded-xl border bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-400",
    "focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent",
    "dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-100",
    invalid
      ? "border-red-400 focus:ring-red-500"
      : "border-neutral-200 dark:border-neutral-800",
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
        className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
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
