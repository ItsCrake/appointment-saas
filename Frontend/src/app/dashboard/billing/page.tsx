import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, ExternalLink } from "lucide-react";

import { db } from "@/db";
import { listInvoices } from "@/db/queries/invoices";
import { cardClass, EmptyState, PageHeader } from "@/components/dashboard/ui";
import { requireBusiness } from "@/lib/dashboard-session";
import { GRACE_DAYS } from "@/lib/billing/lifecycle";
import { entitlementsFor, isDowngraded } from "@/lib/entitlements";
import { formatPrice } from "@/lib/format";
import {
  findTier,
  toPlanType,
  toSubscriptionStatus,
  TRIAL_DAYS,
} from "@/lib/plans";

export const metadata: Metadata = { title: "חיוב ומנוי" };

const STATUS_LABEL: Record<string, string> = {
  trialing: "בתקופת ניסיון",
  active: "מנוי פעיל",
  past_due: "ממתין לתשלום",
  cancelled: "המנוי בוטל",
};

function formatDate(value: Date | null, timezone: string) {
  if (!value) return null;
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "long",
    timeZone: timezone,
  }).format(value);
}

/**
 * Read-only subscription state. There is still no checkout — stage 8d wires a
 * payment provider — so this page reports and never collects.
 *
 * It exists now rather than with checkout because the freeze banner and the
 * branding upsell both need somewhere real to send an owner. A recovery path
 * that 404s is worse than no button.
 */
export default async function BillingPage() {
  // Deliberately `requireBusiness`, not `requireWritable`: a frozen owner must
  // be able to reach the one page that explains how to get un-frozen.
  const { business } = await requireBusiness();

  const plan = toPlanType(business.planType);
  const status = toSubscriptionStatus(business.subscriptionStatus);
  const tier = findTier(plan);
  const entitlements = entitlementsFor(business);
  const downgraded = isDowngraded(business);

  const graceEndsAt = business.graceStartedAt
    ? new Date(business.graceStartedAt.getTime() + GRACE_DAYS * 86_400_000)
    : null;

  const invoices = await listInvoices(db, business.id);

  return (
    <div>
      <PageHeader
        title="חיוב ומנוי"
        subtitle="מצב המנוי, המסלול והחשבוניות שלכם"
      />

      <div className={`${cardClass} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs text-neutral-500">המסלול הנוכחי</p>
            <p className="mt-0.5 text-lg font-bold text-neutral-900 dark:text-neutral-50">
              {tier?.name ?? "חינמי"}
            </p>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-neutral-200 pt-4 sm:grid-cols-2 dark:border-neutral-800">
          {tier ? (
            <div>
              <dt className="text-xs text-neutral-500">מחיר</dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">
                {formatPrice(
                  business.billingCycle === "yearly"
                    ? tier.yearlyCents
                    : tier.monthlyCents,
                )}
                <span className="font-normal text-neutral-500">
                  {business.billingCycle === "yearly" ? " לשנה" : " לחודש"}
                </span>
              </dd>
            </div>
          ) : null}

          {status === "trialing" && business.trialEndsAt ? (
            <div>
              <dt className="text-xs text-neutral-500">
                הניסיון ({TRIAL_DAYS} ימים) מסתיים
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {formatDate(business.trialEndsAt, business.timezone)}
              </dd>
            </div>
          ) : null}

          {status === "past_due" && graceEndsAt ? (
            <div>
              <dt className="text-xs text-neutral-500">
                עמוד ההזמנות ייסגר בתאריך
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                {formatDate(graceEndsAt, business.timezone)}
              </dd>
            </div>
          ) : null}

          {business.currentPeriodEnd ? (
            <div>
              <dt className="text-xs text-neutral-500">
                {business.cancelAtPeriodEnd ? "המנוי יסתיים" : "החידוש הבא"}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {formatDate(business.currentPeriodEnd, business.timezone)}
              </dd>
            </div>
          ) : null}
        </dl>

        {downgraded ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            התכונות של המסלול מושבתות עד להסדרת התשלום. היומן, הלקוחות
            וההיסטוריה נשמרים במלואם.
          </p>
        ) : null}

        {/* Said plainly rather than implied by a missing button: there is no
            checkout yet, and an owner should not be left hunting for one. */}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
          <CreditCard className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          תשלום מקוון עדיין אינו זמין. לשינוי מסלול או להסדרת תשלום צרו קשר
          ונטפל בזה ידנית.
        </p>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        חשבוניות
      </h2>

      {invoices.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="size-5" />}
          title="אין עדיין חשבוניות"
          body="חשבוניות יופיעו כאן אוטומטית לאחר החיוב הראשון."
        />
      ) : (
        <ul
          className={`${cardClass} divide-y divide-neutral-200 dark:divide-neutral-800`}
        >
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatPrice(invoice.amountCents)}
                </span>
                <span className="block text-xs text-neutral-500">
                  {formatDate(invoice.issuedAt, business.timezone)}
                </span>
              </span>
              {invoice.hostedUrl ? (
                <Link
                  href={invoice.hostedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                >
                  צפייה
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!entitlements.customBranding ? (
        <p className="mt-6 text-xs leading-relaxed text-neutral-500">
          במסלול המקצועי נכללים עיצוב מותאם לעמוד ההזמנות, גלריה, חוות דעת
          ותזכורות SMS.
        </p>
      ) : null}
    </div>
  );
}
