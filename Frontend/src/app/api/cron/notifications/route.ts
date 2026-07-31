import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { pruneExpiredRateLimits } from "@/db/queries/rate-limits";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
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
    const summary = await dispatchDueNotifications(db, { limit: 100 });

    // Housekeeping rides along rather than needing a second cron entry.
    let prunedRateLimits = 0;
    try {
      prunedRateLimits = await pruneExpiredRateLimits(db, new Date());
    } catch (error) {
      console.error("rate-limit prune failed", error);
    }

    return NextResponse.json({
      ok: true,
      ...summary,
      prunedRateLimits,
      providers: describeProviders(),
      durationMs: Date.now() - started,
    });
  } catch (error) {
    console.error("cron/notifications failed", error);
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
