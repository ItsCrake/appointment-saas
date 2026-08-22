"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { BookingLink } from "@/components/dashboard/booking-link";

import { saveSettingsAction } from "@/app/dashboard/settings/actions";
import { INACTIVE_DAYS } from "@/lib/retention";

import { useSectionForm, type SaveResult } from "./settings-dirty";

type Business = {
  name: string;
  slug: string;
  phone: string;
  address: string;
  description: string;
  bufferMin: number;
  cancelWindowHours: number;
  reminderHoursBefore: number;
  waitlistOfferTtlMin: number;
  notificationEmail: string;
  timezone: string;
  requiresApproval: boolean;
  retentionEnabled: boolean;
};

type Values = Omit<
  Business,
  | "bufferMin"
  | "cancelWindowHours"
  | "reminderHoursBefore"
  | "waitlistOfferTtlMin"
> & {
  /** Held as strings so a half-typed number does not become NaN mid-keystroke. */
  bufferMin: string;
  cancelWindowHours: string;
  reminderHoursBefore: string;
  waitlistOfferTtlMin: string;
};

export function SettingsForm({
  appUrl,
  business,
  canUseRetention,
}: {
  /** Resolved server-side from the request, for the shareable link. */
  appUrl: string;
  business: Business;
  /** Pro-only. The action re-checks it; this decides whether to offer it. */
  canUseRetention: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();

  const onSave = useCallback(
    async (form: Values): Promise<SaveResult> => {
      setError(undefined);

      const result = await saveSettingsAction({
        name: form.name,
        slug: form.slug,
        phone: form.phone,
        address: form.address,
        description: form.description,
        bufferMin: Number(form.bufferMin),
        cancelWindowHours: Number(form.cancelWindowHours),
        reminderHoursBefore: Number(form.reminderHoursBefore),
        waitlistOfferTtlMin: Number(form.waitlistOfferTtlMin),
        notificationEmail: form.notificationEmail,
        requiresApproval: form.requiresApproval,
        retentionEnabled: form.retentionEnabled,
      });

      if (result.ok) {
        // The slug may have changed, and the header links to it.
        router.refresh();
        return { ok: true };
      }

      // Kept inline as well as in the bar's toast: this one names a specific
      // field, and the owner has to look at the field to fix it.
      setError(result.error);
      return { ok: false, error: result.error };
    },
    [router],
  );

  const { values: form, setValues: setForm } = useSectionForm<Values>({
    id: "details",
    label: "פרטי העסק",
    initial: {
      ...business,
      bufferMin: String(business.bufferMin),
      cancelWindowHours: String(business.cancelWindowHours),
      reminderHoursBefore: String(business.reminderHoursBefore),
      waitlistOfferTtlMin: String(business.waitlistOfferTtlMin),
    },
    onSave,
  });

  function set<K extends keyof Values>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Separate from `set` so the string fields keep their narrow signature. */
  function setFlag(
    key: "requiresApproval" | "retentionEnabled",
    value: boolean,
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    // Still a <form> for the semantics and for Enter-to-submit, but submitting
    // is a no-op: the page has one save control and it is the bar.
    <form
      onSubmit={(event) => event.preventDefault()}
      noValidate
      className="space-y-6"
    >
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
            <span className="shrink-0 text-sm text-zinc-400">/</span>
            <input
              id="slug"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={`${FIELD} text-start`}
            />
          </div>
        </Field>

        {/*
          Built from `business.slug` — the **saved** value — not `form.slug`.
          Copying a link assembled from the field being edited would hand a
          client a URL that 404s: the shop still lives at the old address until
          this form is submitted.
        */}
        <Field
          label="הקישור לשיתוף"
          hint="זה מה ששולחים ללקוחות. אפשר להעתיק ולהדביק בוואטסאפ, באינסטגרם או בכל מקום אחר."
        >
          <BookingLink appUrl={appUrl} slug={business.slug} />
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

              onFocus={(e) => e.target.select()}
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

              onFocus={(e) => e.target.select()}
              onChange={(e) => set("cancelWindowHours", e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
          {/* Beside the cancellation window on purpose: both are the same kind
              of promise to a client about how long something stays theirs, and
              an owner setting one is usually thinking about the other. */}
          <Field
            label="חלון תפיסת תור מהמתנה (דקות)"
            htmlFor="waitlistOfferTtlMin"
            hint="כמה זמן ההצעה שמורה למי שקיבל אותה. אחר כך היא עוברת לבא בתור. 0 מבטל פקיעה."
          >
            <input
              id="waitlistOfferTtlMin"
              type="number"
              min={0}
              max={10080}
              step={15}
              value={form.waitlistOfferTtlMin}
              onFocus={(e) => e.target.select()}
              onChange={(e) => set("waitlistOfferTtlMin", e.target.value)}
              className={`${FIELD} tabular-nums`}
            />
          </Field>
        </div>

        {/* A booking rule, so it lives with the booking rules rather than in a
            section of its own. It changes what a client gets at the end of the
            flow more than anything else on this page. */}
        <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            type="checkbox"
            checked={form.requiresApproval}
            onChange={(e) => setFlag("requiresApproval", e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              תורים באישור
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
              תורים חדשים יגיעו כבקשה שממתינה לאישורכם. המועד נשמר עבור הלקוח
              בינתיים, כדי שלא ייתפס בזמן שאתם מחליטים.
            </span>
          </span>
        </label>

        <p className="text-xs text-zinc-500">
          אזור זמן: <span className="font-medium">{business.timezone}</span>
        </p>
      </Section>

      {/* Rendered only for tenants who can actually use it. An upsell panel
          would be the wrong shape here: this is not a feature someone is
          missing out on so much as a decision to start messaging their own
          customers, and dangling it is how a shop ends up switching on
          something it has not thought about. */}
      {canUseRetention ? (
        <Section title="החזרת לקוחות">
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="checkbox"
              checked={form.retentionEnabled}
              onChange={(e) => setFlag("retentionEnabled", e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
            />
            <span>
              <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                תזכורת אוטומטית ללקוחות שלא חזרו
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                לקוח שלא קבע תור {INACTIVE_DAYS} ימים ואין לו תור עתידי יקבל
                הודעת וואטסאפ חמה מהעסק שלכם. נשלחת רק ללקוחות שסימנו הסכמה
                בטופס ההזמנה, ותמיד עם אפשרות להסרה.
              </span>
            </span>
          </label>

          {/* Said on screen rather than left to be discovered: the switch does
              nothing at all without a WhatsApp account, and an owner who turns
              it on and sees no messages will reasonably assume it is broken. */}
          <p className="text-xs leading-relaxed text-zinc-500">
            ההודעות נשלחות מחשבון הוואטסאפ של העסק. ללא חיבור וואטסאפ פעיל לא
            יישלח דבר.
          </p>
        </Section>
      ) : null}

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

              onFocus={(e) => e.target.select()}
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
    </form>
  );
}

const FIELD =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-zinc-950 dark:focus:ring-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
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
  /**
   * Optional: most fields label a single control, but some wrap a composite
   * (the share link is a URL, a copy button and a preview link) where there is
   * no one input for the label to point at.
   */
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // A `<label>` with no `for` is a label pointing at nothing, which is worse
  // than a plain heading: assistive technology announces it as associated with
  // a control that does not exist. So the element changes with the prop.
  const Tag = htmlFor ? "label" : "p";

  return (
    <div>
      <Tag
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
      >
        {label}
      </Tag>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
