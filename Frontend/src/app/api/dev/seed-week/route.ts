import { NextResponse } from "next/server";
import { like, or, sql } from "drizzle-orm";

import { createBookingAction, fetchSlotsAction } from "@/app/[slug]/actions";
import { cancelBookingAction } from "@/app/b/[token]/actions";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { REFUSAL, suppressionFrom } from "@/db/seed-safety";
import { DEMO_NAILS_SLUG, DEMO_SLUG } from "@/lib/demo";
import { getActiveBusinessBySlug, listServices } from "@/db/queries";
import { getClientIp } from "@/lib/request-context";
import { MIN_HUMAN_FILL_MS } from "@/lib/validation";

/**
 * Fills a week by *booking* it, through the same actions a client uses.
 *
 * ---------------------------------------------------------------------------
 * **A route rather than a script, because the actions cannot be called from
 * one.** `fetchSlotsAction` and `createBookingAction` both reach for
 * `getClientIp()`, which calls `headers()`, which throws outside a request
 * scope — a plain `tsx` script gets "`headers` was called outside a request
 * scope" and nothing else. Running the loop *inside* a request is what makes
 * the real path reachable: real headers, real rate limiting, real availability,
 * real validation, real outbox writes.
 *
 * So nothing here computes a slot. It asks `fetchSlotsAction` what is free and
 * books one of the answers, which is the only way to actually test the three
 * rules this exists for — buffer padding, live availability, and duration
 * against posted hours. A seeder that worked those out for itself would agree
 * with itself and prove nothing.
 *
 * **It is not reachable unless somebody deliberately turns it on.** No
 * `SEED_ROUTE_ENABLED=true` in the environment and this is a 404, not a 403 —
 * an endpoint that writes a hundred bookings should not announce itself to
 * somebody probing for it. On top of that: demo tenants only, and the same
 * WhatsApp suppression check the offline seeder uses, because every booking
 * here queues a real notification and a hundred of those dispatched for real is
 * spam to people who never booked anything.
 *
 * **The rate limiter is cleared as it goes, and that is the honest part.** Ten
 * bookings an hour from one IP is correct for the public internet and fatal to
 * a volume test that needs a hundred from one machine. The counters are removed
 * between attempts rather than the rules being weakened — the product's limits
 * are untouched, and this route only ever deletes rows keyed to *its own*
 * caller.
 * ---------------------------------------------------------------------------
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A hundred sequential bookings, each doing real availability work. */
export const maxDuration = 300;

/** Demo tenants only. A real shop's week is not a test fixture. */
const ALLOWED = [DEMO_SLUG, DEMO_NAILS_SLUG] as const;

const FIRST = [
  "עומר", "איתי", "אלון", "יונתן", "דניאל", "רועי", "נדב", "אורי",
  "מיה", "נועה", "עדי", "שירה", "דנה", "יעל", "רוני", "טל",
  "אביב", "ליאור", "שחר", "עידן", "מאור", "גיא", "אסף", "תומר",
];
const LAST = [
  "לוי", "כהן", "מזרחי", "ברקת", "אביטן", "פרץ", "גולן", "אזולאי",
  "שגב", "בן חיים", "דהן", "קסטיאל", "אוחיון", "אלבז", "נחום", "שרון",
];

/**
 * `056` is a valid `05`+8 shape that `isValidPhone` accepts and not an
 * allocated Israeli mobile block, and `example.com` is reserved by RFC 2606 so
 * test addresses cannot deliver. Defence in depth behind the dispatch check,
 * never a substitute for it.
 */
const UNROUTABLE_PREFIX = "056";

/** Median of a small sample, or 0 when there is none. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const pick = <T,>(items: readonly T[]) =>
  items[Math.floor(Math.random() * items.length)];

/**
 * Deletes this caller's own booking counters.
 *
 * Scoped to the identifier the limiter actually keyed on, so a run cannot
 * clear anybody else's budget. The phone rules are left alone: every simulated
 * client gets its own number, so five-a-day is never approached.
 */
async function clearOwnRateLimits(ip: string) {
  await db
    .delete(rateLimits)
    .where(
      or(
        like(rateLimits.key, `booking:ip:h:${ip}:%`),
        like(rateLimits.key, `booking:ip:d:${ip}:%`),
        like(rateLimits.key, `slots:ip:h:${ip}:%`),
      ),
    );
}

type Booked = {
  id: string;
  cancelToken: string;
  startsAt: string;
  serviceName: string;
  awaitingApproval: boolean;
};

export async function POST(request: Request) {
  // Absent, and the route does not exist. Deliberately 404 rather than 403.
  if (process.env.SEED_ROUTE_ENABLED !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const [platform] = await db.execute<{ disabled: boolean | null }>(
    sql`select whatsapp_dispatch_disabled as disabled from platform_settings limit 1`,
  );

  const suppressedBy = suppressionFrom({
    platformDisabled: platform?.disabled ?? null,
    envValue: process.env.DISABLE_WHATSAPP_DISPATCH,
  });

  if (!suppressedBy) {
    return NextResponse.json({ ok: false, error: REFUSAL }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    date?: string;
  };

  const slug = body.slug ?? DEMO_SLUG;
  if (!(ALLOWED as readonly string[]).includes(slug)) {
    return NextResponse.json(
      { ok: false, error: `slug must be one of ${ALLOWED.join(", ")}` },
      { status: 400 },
    );
  }

  /**
   * **One day per request, and that is a correction rather than a preference.**
   *
   * Filling the whole week inside a single request meant holding the response
   * open for the entire run — every booking is a fresh availability
   * computation against a database in another region — and the client's fetch
   * gave up at undici's five-minute header timeout with 23 rows written and no
   * report. Per-day requests finish in seconds, report as they go, and lose one
   * day rather than everything when something does time out.
   */
  const date = body.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) {
    return NextResponse.json({ ok: false, error: "no such business" }, { status: 404 });
  }

  const services = await listServices(db, business.id);
  if (services.length === 0) {
    return NextResponse.json({ ok: false, error: "no active services" }, { status: 409 });
  }

  const ip = await getClientIp();
  const booked: Booked[] = [];
  const cancelled: string[] = [];
  const perDay: Record<string, number> = {};
  const refusals: Record<string, number> = {};
  let serial = 0;

  /**
   * How long each half of a real booking takes.
   *
   * Reported because it stopped being a seeding detail the moment it was
   * measured: these are the two calls a client's browser waits on, so the
   * numbers here are what somebody standing on the booking page experiences.
   */
  const timing = { slots: [] as number[], book: [] as number[] };

  {
    perDay[date] = 0;

    /**
     * **The day is full when no service has a slot left, not after N tries.**
     *
     * Availability shrinks as the day fills — every booking removes its own
     * slot *and* whatever the buffer covers on either side — so the only
     * honest stopping condition is asking every service and being told no by
     * all of them.
     */
    /**
     * **A service that has run out for a day cannot come back.**
     *
     * Availability only ever shrinks as a day fills — each booking removes its
     * own slot and whatever the buffer covers either side — so once
     * `fetchSlotsAction` returns nothing for a service, it will return nothing
     * for the rest of the run. Remembering that turns the loop from "ask all
     * five services every time" into one query per booking, which is the
     * difference between a day finishing in seconds and a day timing out at
     * four minutes against a database in another region.
     *
     * It costs no fidelity: the set only grows on an answer the engine gave.
     */
    const exhausted = new Set<string>();

    for (;;) {
      const candidates = services.filter((service) => !exhausted.has(service.id));
      if (candidates.length === 0) break;

      await clearOwnRateLimits(ip);

      const service = pick(candidates);
      const slotsAt = Date.now();
      const slots = await fetchSlotsAction(slug, service.id, date);
      timing.slots.push(Date.now() - slotsAt);

      if (!slots.ok) {
        refusals[slots.error] = (refusals[slots.error] ?? 0) + 1;
        exhausted.add(service.id);
        continue;
      }

      if (slots.slots.length === 0) {
        exhausted.add(service.id);
        continue;
      }

      const slot = pick(slots.slots);
      serial += 1;

      const bookAt = Date.now();
      const outcome = await createBookingAction({
        slug,
        serviceId: service.id,
        startsAt: slot.startsAt,
        clientName: `${pick(FIRST)} ${pick(LAST)}`,
        clientPhone: `${UNROUTABLE_PREFIX}${String(1_000_000 + serial).slice(-7)}`,
        clientEmail: `test.${serial}@example.com`,
        /**
         * Above `MIN_HUMAN_FILL_MS`, and this is not cosmetic. Below it the
         * honeypot classifies the submission as a bot and returns a
         * *fabricated* confirmation — a success with no row behind it. A
         * seeder that sent 0 here would report a full week and write nothing.
         */
        elapsedMs: MIN_HUMAN_FILL_MS + 1_000 + Math.floor(Math.random() * 20_000),
      });

      timing.book.push(Date.now() - bookAt);

      if (outcome.ok) {
        booked.push({
          id: outcome.appointment.id,
          cancelToken: outcome.appointment.cancelToken,
          startsAt: outcome.appointment.startsAt,
          serviceName: outcome.appointment.serviceName,
          awaitingApproval: outcome.appointment.awaitingApproval,
        });
        perDay[date] += 1;
        continue;
      }

      refusals[outcome.error] = (refusals[outcome.error] ?? 0) + 1;

      /**
       * Anything other than the race is the engine declining this service for
       * this day, so stop asking it. `SLOT_TAKEN` is the exception — somebody
       * took the slot between the lookup and the write, which is exactly the
       * race the exclusion constraint exists for, and the next slot may well
       * be free.
       */
      if (outcome.code !== "SLOT_TAKEN") exhausted.add(service.id);
    }
  }

  /**
   * A few cancellations, through the client's own cancel link.
   *
   * The booking API cannot produce a cancelled appointment — only a client
   * with the token can — so this is the real second half of the flow rather
   * than a status written by hand. It also frees the slot again, exactly as it
   * would in life; nothing rebooks it, so the week keeps a realistic hole or
   * two rather than a suspiciously perfect wall.
   */
  for (const row of booked) {
    if (Math.random() > 0.08) continue;
    const outcome = await cancelBookingAction(row.cancelToken);
    if (outcome.ok) cancelled.push(row.id);
  }

  await clearOwnRateLimits(ip);

  return NextResponse.json({
    ok: true,
    slug,
    suppressedBy,
    booked: booked.length,
    awaitingApproval: booked.filter((row) => row.awaitingApproval).length,
    cancelled: cancelled.length,
    perDay,
    /** Median rather than mean: one cold connection should not set the number. */
    msPerSlotLookup: median(timing.slots),
    msPerBooking: median(timing.book),
    // Every distinct refusal the run met, with counts. A day that stopped
    // early because of a rule is the interesting result, not a failure.
    refusals,
  });
}
