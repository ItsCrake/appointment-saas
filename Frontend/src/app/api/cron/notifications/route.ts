import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { pruneExpiredRateLimits } from "@/db/queries/rate-limits";
import { sweepSubscriptions } from "@/lib/billing/sweep";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import { reportError } from "@/lib/observability";
import { describeProviders } from "@/lib/notifications/providers";

export const dynamic = "force-dynamic";
// Sending can outlast the default limit when a batch is large.
export const maxDuration = 60;

/**
 * Cron entry point. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Without CRON_SECRET set the route refuses to run rather than defaulting to
 * open — an unauthenticated endpoint that sends email is an abuse vector.
 */
function isAuthorised(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!isAuthorised(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorised or CRON_SECRET not configured" },
      { status: 401 },
    );
  }

  const started = Date.now();

  try {
    // Sweep BEFORE dispatch, so a warning queued this run goes out this run
    // rather than sitting a full day. On a daily cron that ordering is the
    // difference between a 3-day warning and a 2-day one.
    let billing = null;
    try {
      billing = await sweepSubscriptions(db);
    } catch (error) {
      // A failed sweep must not stop the outbox: bookings are the product,
      // billing is the business. Reported, not rethrown.
      reportError("cron.sweepSubscriptions", error);
    }

    const summary = await dispatchDueNotifications(db, { limit: 100 });

    // Housekeeping rides along rather than needing a second cron entry.
    let prunedRateLimits = 0;
    try {
      prunedRateLimits = await pruneExpiredRateLimits(db, new Date());
    } catch (error) {
      reportError("cron.pruneRateLimits", error);
    }

    return NextResponse.json({
      ok: true,
      ...summary,
      billing,
      prunedRateLimits,
      providers: describeProviders(),
      durationMs: Date.now() - started,
    });
  } catch (error) {
    reportError("cron.notifications", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

// Vercel Cron issues GET; POST is here for manual triggering and testing.
export async function POST(request: NextRequest) {
  return handle(request);
}
