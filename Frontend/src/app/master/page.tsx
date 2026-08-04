import {
  Building2,
  CalendarPlus,
  Percent,
  Snowflake,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { EmptyPanel, MetricCard, panel } from "@/components/master/ui";
import { db } from "@/db";
import { requireSuperAdmin } from "@/lib/master-session";
import { getPlatformPulse, listTenants } from "@/db/queries";
import { formatPrice } from "@/lib/format";
import {
  breakdownTenants,
  monthlyRecurringCents,
  trialConversionPercent,
  trialPipelineCents,
} from "@/lib/platform-metrics";
import { toPlanType, toSubscriptionStatus } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function MasterOverviewPage() {
  // Re-checked per page, not only in the layout: a client-side navigation
  // between tabs reuses the layout without re-running it, so the page RSC
  // would otherwise fetch platform-wide data behind no guard at all.
  await requireSuperAdmin();

  const now = new Date();
  const [tenants, pulse] = await Promise.all([
    listTenants(db),
    getPlatformPulse(db, now),
  ]);

  // The columns are varchar, so every read is normalised before the maths —
  // a value written by psql cannot skew a number on this page.
  const rows = tenants.map((t) => ({
    planType: toPlanType(t.planType),
    subscriptionStatus: toSubscriptionStatus(t.subscriptionStatus),
    isActive: t.isActive,
  }));

  const breakdown = breakdownTenants(rows);
  const mrr = monthlyRecurringCents(rows);
  const pipeline = trialPipelineCents(rows);
  const conversion = trialConversionPercent(rows);

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-50">סקירת פלטפורמה</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          מצב כל העסקים במערכת, בזמן אמת
        </p>
      </header>

      {breakdown.total === 0 ? (
        <EmptyPanel
          title="אין עדיין עסקים במערכת"
          body="ברגע שעסק ראשון ישלים הרשמה הוא יופיע כאן, יחד עם המדדים שלו."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              icon={<Building2 className="size-3.5" aria-hidden />}
              label="עסקים פעילים"
              value={String(breakdown.active)}
              hint={`${breakdown.total} סה״כ · ${breakdown.trialing} בניסיון`}
              tone="teal"
            />
            <MetricCard
              icon={<Wallet className="size-3.5" aria-hidden />}
              label="הכנסה חודשית צפויה"
              value={formatPrice(mrr)}
              // Nothing bills yet, so the wording never says "revenue".
              hint={`${formatPrice(pipeline)} נוספים בצנרת הניסיון`}
              tone="teal"
            />
            <MetricCard
              icon={<Percent className="size-3.5" aria-hidden />}
              label="המרת ניסיון"
              value={conversion === null ? "—" : `${conversion}%`}
              hint={
                conversion === null
                  ? "אף חשבון עוד לא הכריע"
                  : "מתוך מי שכבר החליט"
              }
            />
            <MetricCard
              icon={<Snowflake className="size-3.5" aria-hidden />}
              label="מוקפאים"
              value={String(breakdown.frozen)}
              hint={`${breakdown.cancelled} ביטלו מנוי`}
              tone={breakdown.frozen > 0 ? "warn" : "plain"}
            />
          </div>

          <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <TrendingUp className="size-4" aria-hidden />
            דופק המערכת — תורים שנקבעו
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              icon={<CalendarPlus className="size-3.5" aria-hidden />}
              label="24 שעות"
              value={String(pulse.today)}
            />
            <MetricCard
              icon={<CalendarPlus className="size-3.5" aria-hidden />}
              label="7 ימים"
              value={String(pulse.week)}
            />
            <MetricCard
              icon={<CalendarPlus className="size-3.5" aria-hidden />}
              label="30 יום"
              value={String(pulse.month)}
            />
          </div>

          <p
            className={`${panel} mt-6 p-4 text-xs leading-relaxed text-slate-500`}
          >
            ההכנסה מחושבת לפי המסלול שנבחר בכל עסק. אין עדיין חיוב בפועל — המספר
            מייצג את הפוטנציאל של הרשימה הנוכחית, לא כסף שנגבה.
          </p>
        </>
      )}
    </div>
  );
}
