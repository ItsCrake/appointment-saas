import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, ExternalLink } from "lucide-react";

import { db } from "@/db";
import { listInvoices } from "@/db/queries/invoices";
import { PlanPicker } from "@/components/dashboard/plan-picker";
import { cardClass, EmptyState, PageHeader } from "@/components/dashboard/ui";
import { isBillingLive } from "@/lib/billing/providers";
import { requireBusiness } from "@/lib/dashboard-session";
import { daysUntil, GRACE_DAYS } from "@/lib/billing/lifecycle";
import {
  effectivePlan,
  entitlementsFor,
  isDowngraded,
  isTrialing,
} from "@/lib/entitlements";
import { formatPrice } from "@/lib/format";
import { findTier, toPlanType, toSubscriptionStatus } from "@/lib/plans";

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

  const status = toSubscriptionStatus(business.subscriptionStatus);
  const trialing = isTrialing(business);

  // What the page shows is what the tenant actually *has*, not what the column
  // says. During a trial that is the full Pro tier, so showing "בסיסי" beside
  // features they can demonstrably use was the confusing half of this bug.
  const plan = effectivePlan(business);
  const tier = findTier(plan);
  const entitlements = entitlementsFor(business);
  const downgraded = isDowngraded(business);

  // Derived from the tenant's own clock, never from TRIAL_DAYS. A trial
  // extended by `/master` is longer than the constant, and printing the
  // constant would confidently tell that owner the wrong number.
  const trialDaysLeft = business.trialEndsAt
    ? Math.max(daysUntil(business.trialEndsAt, new Date()), 0)
    : null;

  const graceEndsAt = business.graceStartedAt
    ? new Date(business.graceStartedAt.getTime() + GRACE_DAYS * 86_400_000)
    : null;

  const invoices = await listInvoices(db, business.id);
  const billingLive = isBillingLive();

  return (
    <div>
      <PageHeader
        title="חיוב ומנוי"
        subtitle="מצב המנוי, המסלול והחשבוניות שלכם"
      />

      <div className={`${cardClass} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">
              {trialing ? "המסלול בתקופת הניסיון" : "המסלול הנוכחי"}
            </p>
            <p className="mt-0.5 text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {tier ? `מסלול ${tier.name}` : "חינמי"}
              {trialing ? " (Pro)" : ""}
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
          {tier ? (
            <div>
              <dt className="text-xs text-zinc-500">
                {trialing ? "המחיר בתום הניסיון" : "מחיר"}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {formatPrice(
                  business.billingCycle === "yearly"
                    ? tier.yearlyCents
                    : tier.monthlyCents,
                )}
                <span className="font-normal text-zinc-500">
                  {business.billingCycle === "yearly" ? " לשנה" : " לחודש"}
                </span>
              </dd>
            </div>
          ) : null}

          {trialing && business.trialEndsAt ? (
            <div>
              <dt className="text-xs text-zinc-500">
                {trialDaysLeft === 0
                  ? "הניסיון מסתיים היום"
                  : `נותרו ${trialDaysLeft} ימי ניסיון`}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {formatDate(business.trialEndsAt, business.timezone)}
              </dd>
            </div>
          ) : null}

          {status === "past_due" && graceEndsAt ? (
            <div>
              <dt className="text-xs text-zinc-500">
                עמוד ההזמנות ייסגר בתאריך
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                {formatDate(graceEndsAt, business.timezone)}
              </dd>
            </div>
          ) : null}

          {business.currentPeriodEnd ? (
            <div>
              <dt className="text-xs text-zinc-500">
                {business.cancelAtPeriodEnd ? "המנוי יסתיים" : "החידוש הבא"}
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {formatDate(business.currentPeriodEnd, business.timezone)}
              </dd>
            </div>
          ) : null}
        </dl>

        {trialing ? (
          // Stated rather than implied. The tenant may have picked Basic at
          // signup and is being shown Pro at ₪99: without this line that reads
          // as a price they did not agree to, instead of what it is.
          <p className="mt-4 rounded-xl bg-violet-50 px-4 py-3 text-xs leading-relaxed text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
            בתקופת הניסיון פתוחות לכם כל התכונות של המסלול המקצועי: עיצוב מותאם,
            גלריה, חוות דעת ותזכורות SMS. בסיום הניסיון תוכלו לבחור את המסלול
            שמתאים לכם, ולא נחייב אתכם בלי אישור.
          </p>
        ) : null}

        {downgraded ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            התכונות של המסלול מושבתות עד להסדרת התשלום. היומן, הלקוחות
            וההיסטוריה נשמרים במלואם.
          </p>
        ) : null}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {trialing ? "בחירת מסלול להמשך" : "שינוי מסלול"}
      </h2>
      <PlanPicker
        currentPlan={toPlanType(business.planType)}
        currentCycle={business.billingCycle === "yearly" ? "yearly" : "monthly"}
        live={billingLive}
      />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
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
          className={`${cardClass} divide-y divide-zinc-200 dark:divide-zinc-800`}
        >
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatPrice(invoice.amountCents)}
                </span>
                <span className="block text-xs text-zinc-500">
                  {formatDate(invoice.issuedAt, business.timezone)}
                </span>
              </span>
              {invoice.hostedUrl ? (
                <Link
                  href={invoice.hostedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
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
        <p className="mt-6 text-xs leading-relaxed text-zinc-500">
          במסלול המקצועי נכללים עיצוב מותאם לעמוד ההזמנות, גלריה, חוות דעת
          ותזכורות SMS.
        </p>
      ) : null}
    </div>
  );
}
