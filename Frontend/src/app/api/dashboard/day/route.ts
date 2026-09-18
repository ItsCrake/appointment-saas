import { NextResponse } from "next/server";

import { db } from "@/db";
import { loadAgendaDay } from "@/lib/agenda-day-data";
import { requireBusiness } from "@/lib/dashboard-session";

/**
 * `GET /api/dashboard/day?date=YYYY-MM-DD` — one day of the agenda.
 *
 * The agenda used to step days with a `<Link>` to `?date=`, which re-ran the
 * layout and every query on the page — the day's stats, the pending requests,
 * the services and the staff, none of which depend on the day — behind a
 * full-page skeleton: 2.5–2.9s a step, measured on a production build. Only
 * the day's appointments change, so only they are fetched, and `AgendaView`
 * fetches the neighbouring days ahead of the tap.
 *
 * Gated like every dashboard read — see `/api/dashboard/week` — and never
 * cached by the browser.
 */
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { business } = await requireBusiness();
  const date = new URL(request.url).searchParams.get("date") ?? "";

  if (!DATE_PATTERN.test(date)) {
    return NextResponse.json({ error: "bad_date" }, { status: 400 });
  }

  const appointments = await loadAgendaDay(db, business, date);

  return NextResponse.json(
    { date, appointments },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
