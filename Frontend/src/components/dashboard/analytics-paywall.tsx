import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";

import { buildHeatGrid, summariseStatuses } from "@/lib/analytics";
import { cn } from "@/lib/utils";

import {
  HeadlineCards,
  Heatmap,
  Panel,
  StaffPanel,
  StatusPanel,
  TrendPanel,
} from "./analytics-panels";
import { ServicesPanel } from "./services-panel";
import { btnAccent } from "./ui";

/**
 * The Pro gate on `/dashboard/analytics`.
 *
 * ---------------------------------------------------------------------------
 * **The blurred numbers are invented, and that is the point.**
 *
 * The obvious build is to render the tenant's real figures behind a CSS blur.
 * That ships every one of those figures to the browser, where `filter: none` in
 * devtools reveals the lot — a paywall that is decoration rather than a gate.
 * A blur is a visual effect; it has never been an access control.
 *
 * So the preview is a fixed, plausible sample. It shows exactly what the page
 * *is* — the shape of the heatmap, the panels, the ranked bars — without
 * showing anything that belongs to this tenant. Nobody is being teased with
 * their own data they cannot read; they are being shown the feature.
 *
 * It also means this component needs no database call at all, which is why the
 * page can gate before it queries rather than after.
 * ---------------------------------------------------------------------------
 */

/** A believable week for a small shop. Deterministic — never random. */
const SAMPLE_HEAT = [
  { weekday: 0, hour: 9, bookings: 3 },
  { weekday: 0, hour: 10, bookings: 5 },
  { weekday: 0, hour: 11, bookings: 4 },
  { weekday: 1, hour: 10, bookings: 2 },
  { weekday: 1, hour: 12, bookings: 6 },
  { weekday: 2, hour: 9, bookings: 4 },
  { weekday: 2, hour: 13, bookings: 7 },
  { weekday: 3, hour: 11, bookings: 5 },
  { weekday: 3, hour: 14, bookings: 3 },
  { weekday: 4, hour: 10, bookings: 8 },
  { weekday: 4, hour: 12, bookings: 6 },
  { weekday: 4, hour: 15, bookings: 4 },
  { weekday: 5, hour: 9, bookings: 2 },
];

const SAMPLE_SERVICES = [
  { serviceName: "תספורת גבר", bookings: 42, revenueCents: 294000 },
  { serviceName: "תספורת + זקן", bookings: 28, revenueCents: 252000 },
  { serviceName: "עיצוב זקן", bookings: 17, revenueCents: 85000 },
  { serviceName: "צבע", bookings: 9, revenueCents: 108000 },
];

const SAMPLE_STAFF = [
  {
    staffId: "a",
    staffName: "יוסי",
    color: "indigo",
    bookings: 54,
    revenueCents: 410000,
  },
  {
    staffId: "b",
    staffName: "דנה",
    color: "rose",
    bookings: 31,
    revenueCents: 246000,
  },
  {
    staffId: "c",
    staffName: "אבי",
    color: "emerald",
    bookings: 11,
    revenueCents: 83000,
  },
];

const SAMPLE_TREND = [
  { period: "2026-06-07", bookings: 18, revenueCents: 126000 },
  { period: "2026-06-14", bookings: 24, revenueCents: 168000 },
  { period: "2026-06-21", bookings: 21, revenueCents: 147000 },
  { period: "2026-06-28", bookings: 29, revenueCents: 203000 },
  { period: "2026-07-05", bookings: 26, revenueCents: 182000 },
  { period: "2026-07-12", bookings: 34, revenueCents: 238000 },
];

const SAMPLE_STATUSES = [
  { status: "completed", bookings: 78 },
  { status: "confirmed", bookings: 14 },
  { status: "cancelled", bookings: 7 },
  { status: "no_show", bookings: 3 },
];

export function AnalyticsPaywall() {
  const grid = buildHeatGrid(SAMPLE_HEAT);
  const summary = summariseStatuses(SAMPLE_STATUSES);

  return (
    <div className="relative">
      {/* The sample, blurred and inert. `aria-hidden` and `inert` together:
          one hides it from a screen reader, the other stops a keyboard reaching
          the links inside it — a blurred control is still a focusable one. */}
      <div
        aria-hidden
        inert
        className={cn(
          "pointer-events-none space-y-4 blur-[6px] select-none",
          // Faded as well as blurred, so it reads as a backdrop rather than as
          // a page that failed to load.
          "opacity-60",
        )}
      >
        <HeadlineCards
          bookings={96}
          revenueCents={739000}
          busyDay={4}
          busyHour={12}
        />

        <Panel title="מתי העסק עמוס" hint="דוגמה">
          <Heatmap grid={grid} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="מגמה" hint="דוגמה">
            <TrendPanel points={SAMPLE_TREND} granularity="week" />
          </Panel>
          <Panel title="סטטוס התורים" hint="דוגמה">
            <StatusPanel summary={summary} />
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="שירותים" hint="דוגמה">
            <ServicesPanel services={SAMPLE_SERVICES} initialSort="bookings" />
          </Panel>
          <Panel title="חלוקה בין נותני השירות" hint="דוגמה">
            <StaffPanel staff={SAMPLE_STAFF} />
          </Panel>
        </div>
      </div>

      {/* The banner sits over the top of the sample rather than replacing it,
          so the shape of what is being sold stays visible behind the ask. */}
      <div className="absolute inset-0 flex items-start justify-center p-4 pt-16 sm:pt-24">
        <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/95 p-6 text-center shadow-2xl backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95">
          <span
            aria-hidden
            className="inline-flex size-12 items-center justify-center rounded-full bg-[image:var(--brand-gradient)]"
          >
            <Lock className="size-5 text-white" />
          </span>

          <h2 className="mt-3 text-lg font-bold text-zinc-900 dark:text-zinc-50">
            גישה במסלול המקצועי בלבד
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            הדוחות מראים מתי העסק עמוס, מה הכי מבוקש ואיך התורים מתחלקים בין
            נותני השירות — כדי שתדעו מתי להוסיף עובד ומתי לסגור מוקדם.
          </p>

          <ul className="mx-auto mt-4 max-w-xs space-y-1.5 text-start text-xs text-zinc-600 dark:text-zinc-400">
            {[
              "מפת עומס לפי יום ושעה",
              "השירותים המבוקשים והרווחיים",
              "מגמת תורים והכנסה צפויה",
              "חלוקת עומס בין נותני השירות",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Sparkles
                  className="mt-0.5 size-3.5 shrink-0 text-zinc-400"
                  aria-hidden
                />
                {line}
              </li>
            ))}
          </ul>

          <Link href="/dashboard/billing" className={cn(btnAccent, "mt-5")}>
            שדרוג למסלול המקצועי
          </Link>

          <p className="mt-2 text-[11px] text-zinc-400">
            המספרים למעלה הם הדגמה, לא הנתונים שלכם.
          </p>
        </div>
      </div>
    </div>
  );
}
