import dotenv from "dotenv";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "../lib/demo";

/**
 * Fills a week by booking it, the way a client would.
 *
 * ---------------------------------------------------------------------------
 * **This used to insert rows and now it makes requests, and the difference is
 * the whole point.** A seeder that computes its own start times agrees with
 * itself: it cannot catch a buffer that is not applied, a slot offered inside a
 * break, or a service whose duration runs past closing, because it never asks.
 * This one asks `fetchSlotsAction` what is free and books one of the answers
 * through `createBookingAction` — so a week that fills is evidence about the
 * availability engine, and a week that stops early is a finding rather than a
 * bug in the seeder.
 *
 * **The loop lives in a route, not here, and that is forced rather than
 * chosen.** Both actions call `getClientIp()`, which calls `headers()`, which
 * throws outside a request scope — `tsx` cannot invoke them at all. So the work
 * happens in `/api/dev/seed-week`, inside a real request, and this file is the
 * thing that starts it and prints what came back.
 *
 * The route is a 404 unless `SEED_ROUTE_ENABLED=true`, refuses unless WhatsApp
 * dispatch is suppressed, and accepts only the demo slugs. See its own note.
 * ---------------------------------------------------------------------------
 */

dotenv.config({ path: ".env.local", quiet: true });

const BASE = process.env.SEED_TARGET_URL ?? "http://localhost:3000";

type Report = {
  ok: boolean;
  error?: string;
  slug?: string;
  suppressedBy?: string;
  booked?: number;
  awaitingApproval?: number;
  cancelled?: number;
  perDay?: Record<string, number>;
  refusals?: Record<string, number>;
  msPerSlotLookup?: number;
  msPerBooking?: number;
};

function arg(name: string): string | undefined {
  const flag = process.argv.find((value) => value.startsWith(`--${name}=`));
  return flag?.slice(name.length + 3);
}

/** One day, one request. See the route's note on why it is not one per week. */
async function seedDay(slug: string, date: string): Promise<Report> {
  const response = await fetch(`${BASE}/api/dev/seed-week`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, date }),
    // A day that cannot finish in four minutes is a finding, not something to
    // wait longer for.
    // Generous: a busy day against a database in another region genuinely
    // takes minutes, and the run reports its own timings so the wait is
    // visible rather than mysterious.
    signal: AbortSignal.timeout(900_000),
  });

  if (response.status === 404) {
    throw new Error(
      [
        "",
        "The seed route is not enabled.",
        "",
        "Add SEED_ROUTE_ENABLED=true to .env.local and restart the server.",
        "It is a 404 rather than a 403 on purpose: an endpoint that writes a",
        "hundred bookings should not announce itself to somebody probing for it.",
        "",
      ].join(String.fromCharCode(10)),
    );
  }

  const report = (await response.json()) as Report;
  if (!report.ok) throw new Error(report.error ?? `failed with ${response.status}`);
  return report;
}

/** The shop's own calendar day, which is not the machine's. */
function localDay(offset: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
}

async function seed(slug: string, days: number, timezone: string) {
  let booked = 0;
  let pending = 0;
  let cancelled = 0;
  const refusals: Record<string, number> = {};

  console.log(`/${slug}`);

  for (let day = 0; day < days; day++) {
    const date = localDay(day, timezone);
    const report = await seedDay(slug, date);

    booked += report.booked ?? 0;
    pending += report.awaitingApproval ?? 0;
    cancelled += report.cancelled ?? 0;
    for (const [reason, count] of Object.entries(report.refusals ?? {})) {
      refusals[reason] = (refusals[reason] ?? 0) + count;
    }

    console.log(
      `     ${date}  ${String(report.booked ?? 0).padStart(2)} bookings` +
        (report.cancelled ? `  (${report.cancelled} cancelled after)` : "") +
        `   [slots ${report.msPerSlotLookup}ms, book ${report.msPerBooking}ms]`,
    );
  }

  console.log(`   booked ${booked} (${pending} awaiting approval, ${cancelled} cancelled)`);

  /**
   * Printed rather than swallowed. A day that stopped early because the engine
   * said no is the interesting outcome of this whole exercise — it is the shape
   * a buffer rule or a posted closing time actually takes when you push against
   * it.
   */
  const listed = Object.entries(refusals);
  if (listed.length > 0) {
    console.log("   the engine refused, and why:");
    for (const [reason, count] of listed) {
      console.log(`     ${String(count).padStart(3)} x ${reason}`);
    }
  }
  console.log("");
}

async function main() {
  const only = arg("only");
  const days = Number(arg("days") ?? 7);
  const targets = only ? [only] : [DEMO_SLUG, DEMO_NAILS_SLUG];

  console.log(`Target: ${BASE}`);
  console.log(`Filling ${days} day(s) by booking through the public API.\n`);

  // Both demos run on the shop's own clock; read once rather than assumed.
  const timezone = process.env.SEED_TIMEZONE ?? "Asia/Jerusalem";

  for (const slug of targets) {
    await seed(slug, days, timezone);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
