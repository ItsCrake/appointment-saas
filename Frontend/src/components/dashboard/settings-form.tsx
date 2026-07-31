"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";

import { saveSettingsAction } from "@/app/dashboard/settings/actions";
import { useToast } from "@/components/ui/toast";

type Business = {
  name: string;
  slug: string;
  phone: string;
  address: string;
  description: string;
  bufferMin: number;
  cancelWindowHours: number;
  reminderHoursBefore: number;
  notificationEmail: string;
  timezone: string;
};

export function SettingsForm({ business }: { business: Business }) {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState({
    ...business,
    bufferMin: String(business.bufferMin),
    cancelWindowHours: String(business.cancelWindowHours),
    reminderHoursBefore: String(business.reminderHoursBefore),
  });
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await saveSettingsAction({
        name: form.name,
        slug: form.slug,
        phone: form.phone,
        address: form.address,
        description: form.description,
        bufferMin: Number(form.bufferMin),
        cancelWindowHours: Number(form.cancelWindowHours),
        reminderHoursBefore: Number(form.reminderHoursBefore),
        notificationEmail: form.notificationEmail,
      });

      if (result.ok) {
        toast("ההגדרות נשמרו");
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Section title="פרטי העסק">
        <Field label="שם העסק" htmlFor="name">
          <input
            id="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className={FIELD}
          />
        </Field>

        <Field
          label="כתובת עמוד ההזמנות"
          htmlFor="slug"
          hint="שינוי הכתובת ישבור קישורים ישנים שכבר שיתפתם."
        >
          <div className="flex items-center gap-2" dir="ltr">
            <span className="shrink-0 text-sm text-neutral-400">/</span>
            <input
              id="slug"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={`${FIELD} text-start`}
            />
            <a
              href={`/${business.slug}`}
              target="_blank"
              rel="noreferrer"
              aria-label="פתיחת עמוד ההזמנות"
              className="shrink-0 rounded-lg border border-neutral-200 p-2.5 text-neutral-500 hover:text-neutral-900 dark:border-neutral-700"
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
        </Field>

        <Field label="תיאור קצר" htmlFor="description">
          <input
            id="description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className={FIELD}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="טלפון" htmlFor="phone">
            <input
              id="phone"
              type="tel"
              dir="ltr"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={`${FIELD} text-start`}
            />
          </Field>
          <Field label="כתובת" htmlFor="address">
            <input
              id="address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className={FIELD}
            />
          </Field>
        </div>
      </Section>

      <Section title="כללי קביעת תורים">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="מרווח בין תורים (דקות)"
            htmlFor="bufferMin"
            hint="ברירת מחדל. אפשר לדרוס לכל שירות בנפרד."
          >
            <input
              id="bufferMin"
              type="number"
              min={0}
              max={120}
              value={form.bufferMin}
              onChange={(e) => set("bufferMin", e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          <Field
            label="חלון ביטול (שעות)"
            htmlFor="cancelWindowHours"
            hint="עד כמה זמן לפני התור לקוח יכול לבטל בעצמו."
          >
            <input
              id="cancelWindowHours"
              type="number"
              min={0}
              max={168}
              value={form.cancelWindowHours}
              onChange={(e) => set("cancelWindowHours", e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
        </div>

        <p className="text-xs text-neutral-500">
          אזור זמן: <span className="font-medium">{business.timezone}</span>
        </p>
      </Section>

      <Section title="התראות">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="תזכורת ללקוח (שעות לפני)"
            htmlFor="reminderHoursBefore"
            hint="0 מבטל תזכורות."
          >
            <input
              id="reminderHoursBefore"
              type="number"
              min={0}
              max={168}
              value={form.reminderHoursBefore}
              onChange={(e) => set("reminderHoursBefore", e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          <Field
            label="אימייל להתראות בעל העסק"
            htmlFor="notificationEmail"
            hint="לקבלת הודעה על תור חדש או ביטול. ריק = ללא התראות."
          >
            <input
              id="notificationEmail"
              type="email"
              dir="ltr"
              value={form.notificationEmail}
              onChange={(e) => set("notificationEmail", e.target.value)}
              className={`${FIELD} text-start`}
            />
          </Field>
        </div>
      </Section>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60 md:w-auto md:px-8 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        שמירת הגדרות
      </button>
    </form>
  );
}

const FIELD =
  "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-neutral-400">{hint}</p> : null}
    </div>
  );
}
