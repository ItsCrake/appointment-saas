"use client";

import { useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { AlertCircle, Clock, Loader2, Tag } from "lucide-react";

import type { Slot } from "@/lib/availability";
import { formatDuration, formatFullDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clientDetailsSchema, type ClientDetails } from "@/lib/validation";

import type { BookingService } from "./types";

type Props = {
  service: BookingService;
  slot: Slot;
  timezone: string;
  submitting: boolean;
  serverError?: string;
  onSubmit: (details: ClientDetails) => void;
};

export function DetailsStep({
  service,
  slot,
  timezone,
  submitting,
  serverError,
  onSubmit,
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientDetails>({
    resolver: standardSchemaResolver(clientDetailsSchema),
    mode: "onTouched",
    defaultValues: { clientName: "", clientPhone: "", notes: "" },
  });

  const when = formatFullDateTime(slot.startsAt, timezone);

  return (
    <section aria-labelledby="details-heading" className="px-5">
      <h2
        id="details-heading"
        className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100"
      >
        הפרטים שלכם
      </h2>

      {/* Summary of what is being booked, so nobody confirms blind. */}
      <div className="mb-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">
          {service.name}
        </p>
        <dl className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
          <div className="flex items-center gap-2">
            <dt className="sr-only">מועד</dt>
            <Clock className="size-4 shrink-0" aria-hidden />
            <dd>
              יום {when.weekday}, {when.date} בשעה{" "}
              <span className="font-semibold tabular-nums">{when.time}</span>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="sr-only">מחיר</dt>
            <Tag className="size-4 shrink-0" aria-hidden />
            <dd>
              {formatPrice(service.priceCents, service.currency)} ·{" "}
              {formatDuration(service.durationMin)}
            </dd>
          </div>
        </dl>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
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
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
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

        <p className="pb-2 text-center text-xs text-neutral-400">
          בקביעת התור אתם מאשרים קבלת הודעות בנוגע לתור זה.
        </p>
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
