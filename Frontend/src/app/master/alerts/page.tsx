import { MailWarning, TrendingDown, TriangleAlert } from "lucide-react";

import { EmptyPanel, panel } from "@/components/master/ui";
import { db } from "@/db";
import { requireSuperAdmin } from "@/lib/master-session";
import {
  listChurnRisk,
  listExpiringTrials,
  listFailedDeliveries,
} from "@/db/queries";
import { daysUntil } from "@/lib/platform-metrics";

export const dynamic = "force-dynamic";

/**
 * A date, or null — and **never a throw**.
 *
 * `Intl.DateTimeFormat.format()` coerces its argument with `ToNumber`, so a
 * date *string* becomes `NaN` and the call raises `RangeError: Invalid time
 * value`. In a server component that is not a bad cell, it is the whole page:
 * the render aborts and the browser gets a digest and "this page couldn't
 * load". That is exactly how this page went down — a `max()` aggregate typed as
 * `Date` came back from postgres.js as a string, and the truthiness guard in
 * front of it happily let it through.
 *
 * The aggregate is now mapped at the query so the type is true. This stays
 * because the failure mode is disproportionate: one unparseable value should
 * cost a dash in one row, not the console an operator opens *because*
 * something is wrong.
 */
function shortDate(value: Date | string | null): string | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(date);
}

export default async function MasterAlertsPage() {
  await requireSuperAdmin();

  const now = new Date();

  // Independent reads, so one slow section does not hold up the others.
  const [churn, trials, failures] = await Promise.all([
    listChurnRisk(db, now),
    listExpiringTrials(db, now),
    listFailedDeliveries(db),
  ]);

  const quiet =
    churn.length === 0 && trials.length === 0 && failures.length === 0;

  return (
    <div>
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-50">
          <TriangleAlert className="size-5 text-amber-400" aria-hidden />
          התראות וחריגות
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500">מה דורש תשומת לב עכשיו</p>
      </header>

      {quiet ? (
        <EmptyPanel
          title="אין התראות פתוחות"
          body="אין ניסיונות שפגים בקרוב, אין עסקים שקטים ואין כשלי שליחה."
        />
      ) : null}

      <Section
        icon={<TriangleAlert className="size-4 text-amber-400" aria-hidden />}
        title="ניסיונות שפגים תוך 48 שעות"
        count={trials.length}
      >
        {trials.map((t) => {
          const days = daysUntil(t.trialEndsAt, now);
          return (
            <Row
              key={t.id}
              title={t.name}
              slug={t.slug}
              detail={
                days === null
                  ? "מועד סיום לא ידוע"
                  : days <= 0
                    ? "פג היום"
                    : `נותרו ${days} ימים`
              }
              tone="warn"
            />
          );
        })}
      </Section>

      <Section
        icon={<TrendingDown className="size-4 text-rose-400" aria-hidden />}
        title="עסקים ללא תורים ב-7 הימים האחרונים"
        count={churn.length}
      >
        {churn.map((t) => (
          <Row
            key={t.id}
            title={t.name}
            slug={t.slug}
            detail={
              shortDate(t.lastBookingAt)
                ? `תור אחרון: ${shortDate(t.lastBookingAt)}`
                : "מעולם לא התקבל תור"
            }
            tone="danger"
          />
        ))}
      </Section>

      <Section
        icon={<MailWarning className="size-4 text-rose-400" aria-hidden />}
        title="כשלי שליחה"
        count={failures.length}
      >
        {failures.map((f) => (
          <Row
            key={f.id}
            title={f.businessName}
            slug={`${f.channel} · ${f.kind}`}
            detail={f.lastError ?? `${f.attempts} ניסיונות`}
            tone="danger"
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  // A section with nothing in it is good news, not an empty state worth space.
  if (count === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300">
        {icon}
        {title}
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 tabular-nums">
          {count}
        </span>
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Row({
  title,
  slug,
  detail,
  tone,
}: {
  title: string;
  slug: string;
  detail: string;
  tone: "warn" | "danger";
}) {
  return (
    <li className={`${panel} flex items-center gap-3 px-4 py-3`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">
          {title}
        </span>
        <span dir="ltr" className="block truncate text-[11px] text-zinc-500">
          {slug}
        </span>
      </span>
      <span
        className={`shrink-0 text-xs ${tone === "warn" ? "text-amber-300" : "text-rose-300"}`}
      >
        {detail}
      </span>
    </li>
  );
}
