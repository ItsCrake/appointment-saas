import type { Metadata } from "next";

import {
  HeadlineCards,
  Heatmap,
  Panel,
  RangeTabs,
  ServicesPanel,
  StaffPanel,
  StatusPanel,
  TrendPanel,
  type SortKey,
} from "@/components/dashboard/analytics-panels";
import { AnalyticsPaywall } from "@/components/dashboard/analytics-paywall";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import {
  getBookingTrend,
  getPeakHeatmap,
  getServiceBreakdown,
  getStaffLoad,
  getStatusBreakdown,
} from "@/db/queries";
import {
  analyticsWindow,
  buildHeatGrid,
  busiestHour,
  busiestWeekday,
  granularityFor,
  summariseStatuses,
  toRange,
} from "@/lib/analytics";
import { requireBusiness } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";

export const metadata: Metadata = { title: "אנליטיקס" };

/** Every number here is as of now; a cached page would be a wrong page. */
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ range?: string; by?: string }>;
};

/**
 * `requireBusiness`, not `requireWritable`: a frozen tenant may read their own
 * numbers. Nothing on this page writes.
 */
export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { business } = await requireBusiness();
  const { range: rawRange, by } = await searchParams;

  /**
   * Gated **before** the queries run, not after.
   *
   * The paywall renders invented sample numbers, so there is nothing to fetch
   * for a tenant who cannot see the real ones — and nothing of theirs can leak
   * into a payload behind a CSS blur, which is the way this feature is usually
   * built wrong.
   */
  if (!entitlementsFor(business).canAccessAnalytics) {
    return (
      <div className="pb-4">
        <PageHeader
          title="אנליטיקס"
          subtitle="מתי עמוס, מה מבוקש, ומי עושה מה"
        />
        <AnalyticsPaywall />
      </div>
    );
  }

  const range = toRange(rawRange);
  const sort: SortKey = by === "revenue" ? "revenue" : "bookings";
  const granularity = granularityFor(range);
  const window = analyticsWindow(range, new Date());

  // One round trip each, in parallel. They group differently enough that
  // sharing a scan would mean a query nobody could read.
  const [heat, services, statuses, staff, trend] = await Promise.all([
    getPeakHeatmap(db, business.id, business.timezone, window),
    getServiceBreakdown(db, business.id, window),
    getStatusBreakdown(db, business.id, window),
    getStaffLoad(db, business.id, window),
    getBookingTrend(db, business.id, business.timezone, window, granularity),
  ]);

  const grid = buildHeatGrid(heat);
  const summary = summariseStatuses(statuses);
  const revenueCents = services.reduce((sum, row) => sum + row.revenueCents, 0);

  return (
    <div className="pb-4">
      <PageHeader
        title="אנליטיקס"
        subtitle="מתי עמוס, מה מבוקש, ומי עושה מה"
        action={<RangeTabs current={range} sort={sort} />}
      />

      <div className="space-y-4">
        <HeadlineCards
          bookings={grid.total}
          revenueCents={revenueCents}
          busyDay={busiestWeekday(heat)}
          busyHour={busiestHour(heat)}
        />

        <Panel
          title="מתי העסק עמוס"
          hint="כמה תורים בכל יום ושעה. ככל שהמשבצת כהה יותר — עמוס יותר."
        >
          <Heatmap grid={grid} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="מגמה"
            hint={granularity === "week" ? "תורים לפי שבוע" : "תורים לפי חודש"}
          >
            <TrendPanel points={trend} granularity={granularity} />
          </Panel>

          <Panel
            title="סטטוס התורים"
            hint="כולל תורים שבוטלו, בניגוד לשאר העמוד"
          >
            <StatusPanel summary={summary} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="שירותים" hint="ההכנסה היא צפויה — לא נגבתה">
            <ServicesPanel services={services} sort={sort} range={range} />
          </Panel>

          <Panel title="חלוקה בין נותני השירות" hint="לפי מספר התורים">
            <StaffPanel staff={staff} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
