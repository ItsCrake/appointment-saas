import { NextResponse } from "next/server";

import { db } from "@/db";
import { loadCalendarWeek } from "@/lib/calendar-week-data";
import { requireBusiness } from "@/lib/dashboard-session";
import { todayInTimezone } from "@/lib/format";

/**
 * `GET /api/dashboard/week?week=YYYY-MM-DD` — one week of the full calendar.
 *
 * ---------------------------------------------------------------------------
 * **Why an endpoint and not a page navigation.** Stepping a week used to be a
 * `<Link>` to `?week=`, which re-ran the dashboard layout, re-read the session
 * and re-drew the whole route behind a skeleton — measured at 2.1–2.2s a step
 * on a production build. `WeekCalendar` now switches weeks in its own state
 * and asks this for the data: only the week's own queries, with the
 * neighbouring weeks fetched ahead so a step is usually already in memory.
 *
 * **A read, gated like every dashboard read.** `requireBusiness()` resolves
 * the tenant from the session — a frozen tenant may look at their week — and
 * every query below is scoped to it. Without a session it redirects, which
 * the client treats as "navigate for real".
 *
 * Never cached here: the calendar keeps its own short-lived copy, and a
 * browser cache would outlive the change it was meant to show.
 * ---------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { business } = await requireBusiness();
  const week = new URL(request.url).searchParams.get("week") ?? "";

  if (!DATE_PATTERN.test(week)) {
    return NextResponse.json({ error: "bad_week" }, { status: 400 });
  }

  const data = await loadCalendarWeek(
    db,
    business,
    week,
    todayInTimezone(business.timezone),
  );

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
