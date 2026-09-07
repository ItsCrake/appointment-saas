import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "../lib/demo";
import { makeRandom } from "./demo-data";
import { BLOCKING_STATUSES } from "./queries/appointments";
import * as schema from "./schema";
import {
  appointments,
  businesses,
  services,
  staff,
  workingHours,
} from "./schema";

/**
 * A handful of believable bookings, added to the demo shops without removing
 * anything.
 *
 * ---------------------------------------------------------------------------
 * **This is not `db:seed`, and the difference is the whole reason it exists.**
 * `db:seed` rebuilds a demo tenant: it deletes every appointment, waitlist
 * entry, client note and notification row first. That is right when the demos
 * have drifted and wrong when the ask is "put some appointments in so I can
 * talk to ליבי" — the reset would take the rest of the shop's state with it.
 * This only inserts.
 *
 * **Nothing is placed where something already is.** Every candidate slot is
 * checked against the appointments already in the diary *and* against the ones
 * this run has already planned. A single-provider shop is the common case in
 * both demos, so every booking competes for the same person and
 * `appointments_no_overlap_staff` would otherwise reject half the batch
 * halfway through.
 *
 * **Inside posted hours, deliberately.** ליבי is allowed to book outside them
 * and an owner squeezing somebody in is normal — but *test data* that sits at
 * 06:00 makes every later question about the day read oddly, and the point of
 * these rows is to be a plausible week.
 *
 * Seeded RNG, so a re-run against an empty shop produces the same week and a
 * screenshot can be reproduced. It is not idempotent: run it twice and you get
 * two batches, placed around each other.
 * ---------------------------------------------------------------------------
 */

dotenv.config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error("DIRECT_URL (or DATABASE_URL) is not set in .env.local.");
}

const databaseUrl: string = url;
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client, { schema });

/** How many to add per shop, and how far ahead to scatter them. */
const PER_TENANT = { min: 6, max: 8 } as const;
const DAYS_AHEAD = 6;

type Person = { name: string; phone: string };

/**
 * Real-looking clients, one phone each.
 *
 * The phone is the identity this product derives a client from — `listClients`
 * groups on it — so two people sharing a number would show up as one person who
 * comes in twice as often. Distinct numbers, and valid ones: `05` plus eight
 * digits is what `isValidPhone` accepts, and a demo full of numbers the app's
 * own validator rejects is a trap for the next person who edits one.
 */
const BARBER_CLIENTS: Person[] = [
  { name: "עומר לוי", phone: "0521100341" },
  { name: "איתי שרון", phone: "0521100342" },
  { name: "אלון ברקת", phone: "0521100343" },
  { name: "יונתן מזרחי", phone: "0521100344" },
  { name: "דניאל כהן", phone: "0521100345" },
  { name: "רועי אביטן", phone: "0521100346" },
  { name: "נדב פרץ", phone: "0521100347" },
  { name: "אורי גולן", phone: "0521100348" },
];

const NAILS_CLIENTS: Person[] = [
  { name: "מיה אזולאי", phone: "0522200341" },
  { name: "נועה שגב", phone: "0522200342" },
  { name: "עדי בן חיים", phone: "0522200343" },
  { name: "שירה דהן", phone: "0522200344" },
  { name: "דנה קסטיאל", phone: "0522200345" },
  { name: "יעל אוחיון", phone: "0522200346" },
  { name: "רוני אלבז", phone: "0522200347" },
  { name: "טל נחום", phone: "0522200348" },
];

const TENANTS = [
  { slug: DEMO_SLUG, clients: BARBER_CLIENTS, seed: 20260907 },
  { slug: DEMO_NAILS_SLUG, clients: NAILS_CLIENTS, seed: 20260908 },
];

type Planned = {
  startsAt: Date;
  endsAt: Date;
  person: Person;
  serviceName: string;
  serviceId: string;
  priceCents: number;
  /** For the preview line only. */
  localDay: string;
  localTime: string;
};

/** Half-open overlap, the same test the exclusion constraint applies. */
const clashes = (
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean => aStart < bEnd && bStart < aEnd;

/** "HH:MM:SS" or "HH:MM" to minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

async function planFor(tenant: (typeof TENANTS)[number], now: Date) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, tenant.slug))
    .limit(1);

  if (!business) return { slug: tenant.slug, business: null, planned: [] };

  const timezone = business.timezone;

  const [activeServices, activeStaff, hours] = await Promise.all([
    db
      .select()
      .from(services)
      .where(and(eq(services.businessId, business.id), eq(services.isActive, true)))
      .orderBy(asc(services.sortOrder), asc(services.name)),
    db
      .select()
      .from(staff)
      .where(and(eq(staff.businessId, business.id), eq(staff.isActive, true)))
      .orderBy(asc(staff.sortOrder)),
    db
      .select()
      .from(workingHours)
      .where(eq(workingHours.businessId, business.id)),
  ]);

  if (activeServices.length === 0 || activeStaff.length === 0) {
    return { slug: tenant.slug, business, planned: [], reason: "no service or provider" };
  }

  const from = new Date(now);
  const until = new Date(now.getTime() + DAYS_AHEAD * 86_400_000);

  /**
   * What is already there, per provider.
   *
   * Only the blocking statuses: a cancelled row does not hold its slot, and
   * treating it as if it did would push the whole batch later for no reason.
   */
  const existing = await db
    .select({
      staffId: appointments.staffId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, business.id),
        gte(appointments.endsAt, from),
        lt(appointments.startsAt, until),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
      ),
    );

  const random = makeRandom(tenant.seed);
  const target =
    PER_TENANT.min +
    Math.floor(random() * (PER_TENANT.max - PER_TENANT.min + 1));

  /** Windows the shop is open, per weekday. A split shift is two rows. */
  const windowsFor = (weekday: number) =>
    hours
      .filter((row) => row.weekday === weekday && !row.isClosed)
      .map((row) => ({
        from: toMinutes(row.startTime),
        to: toMinutes(row.endTime),
      }))
      .sort((a, b) => a.from - b.from);

  /**
   * Every slot the shop could take a booking in, grouped by the day it is on.
   *
   * Built on a 15-minute grid rather than the shop's own interval: the demos
   * use 20- and 30-minute services, and a grid that matches one of them makes
   * the day look mechanical. Times a person recognises — 10:15, 16:45 — are
   * what a real diary is full of.
   */
  const byDay: { localDay: string; weekday: number; starts: Date[] }[] = [];
  for (let day = 0; day < DAYS_AHEAD; day++) {
    const at = new Date(now.getTime() + day * 86_400_000);
    const localDay = formatInTimeZone(at, timezone, "yyyy-MM-dd");
    const weekday = Number(formatInTimeZone(at, timezone, "i")) % 7;
    const starts: Date[] = [];

    for (const window of windowsFor(weekday)) {
      for (let minute = window.from; minute < window.to; minute += 15) {
        const hh = String(Math.floor(minute / 60)).padStart(2, "0");
        const mm = String(minute % 60).padStart(2, "0");
        const start = fromZonedTime(`${localDay}T${hh}:${mm}:00`, timezone);
        // Never in the past: an appointment behind the clock is not something
        // a shop would be asked about, and breaks "what is left today".
        if (start.getTime() > now.getTime()) starts.push(start);
      }
    }

    if (starts.length > 0) byDay.push({ localDay, weekday, starts });
  }

  /**
   * How many to put on each open day.
   *
   * ---------------------------------------------------------------------------
   * **Distributed rather than drawn at random, and today is guaranteed.** Purely
   * random picks over the whole fortnight of slots produced a barber shop with
   * nothing at all today and two days carrying everything — which is the one
   * shape this data must not have, because "כמה תורים יש לי היום" is the first
   * thing anybody asks ליבי and an empty answer tests nothing.
   *
   * A closed day contributes no slots and so is never in `byDay` at all — this
   * week that is the Saturday, in both shops.
   * ---------------------------------------------------------------------------
   */
  const quota = new Map<string, number>();
  if (byDay.length > 0) {
    for (const day of byDay) quota.set(day.localDay, 0);
    // Today first, so the remainder falls on it rather than on a Friday.
    quota.set(byDay[0].localDay, 1);
    for (let i = 1; i < target; i++) {
      const day = byDay[i % byDay.length];
      quota.set(day.localDay, (quota.get(day.localDay) ?? 0) + 1);
    }
  }

  const planned: Planned[] = [];

  for (const day of byDay) {
    const wanted = quota.get(day.localDay) ?? 0;
    let placed = 0;

    // Bounded: a day whose slots are all taken simply contributes fewer, rather
    // than spinning.
    for (let attempt = 0; attempt < day.starts.length * 4 && placed < wanted; attempt++) {
      const start = day.starts[Math.floor(random() * day.starts.length)];
      const service = activeServices[Math.floor(random() * activeServices.length)];
      const provider = activeStaff[Math.floor(random() * activeStaff.length)];
      const end = new Date(start.getTime() + service.durationMin * 60_000);

      // Must finish before the window it started in closes.
      const startMinutes = toMinutes(formatInTimeZone(start, timezone, "HH:mm"));
      const window = windowsFor(day.weekday)
        .filter((w) => startMinutes >= w.from)
        .pop();
      if (!window || startMinutes + service.durationMin > window.to) continue;

      const busy =
        existing.some(
          (row) =>
            row.staffId === provider.id &&
            clashes(start, end, row.startsAt, row.endsAt),
        ) ||
        planned.some((row) => clashes(start, end, row.startsAt, row.endsAt));
      if (busy) continue;

      // One booking per person per batch, so the clients list looks like people
      // rather than one very keen customer.
      const taken = new Set(planned.map((row) => row.person.phone));
      const free = tenant.clients.filter((c) => !taken.has(c.phone));
      if (free.length === 0) break;
      const person = free[Math.floor(random() * free.length)];

      planned.push({
        startsAt: start,
        endsAt: end,
        person,
        serviceId: service.id,
        serviceName: service.name,
        priceCents: service.priceCents,
        localDay: day.localDay,
        localTime: formatInTimeZone(start, timezone, "HH:mm"),
      });
      placed++;
    }
  }

  planned.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return {
    slug: tenant.slug,
    business,
    planned,
    staffId: activeStaff[0].id,
    timezone,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  console.log(`Database: ${databaseUrl.replace(/:[^:@]*@/, ":****@")}`);
  console.log(dryRun ? "DRY RUN — nothing will be written.\n" : "Inserting.\n");

  for (const tenant of TENANTS) {
    const plan = await planFor(tenant, now);

    if (!plan.business) {
      console.log(`/${tenant.slug} — not present, skipped.\n`);
      continue;
    }

    const [before] = await db.execute<{ n: number; upcoming: number }>(sql`
      select count(*)::int as n,
             count(*) filter (where starts_at >= now())::int as upcoming
      from appointments where business_id = ${plan.business.id}
    `);

    console.log(`/${tenant.slug} — "${plan.business.name}"`);
    console.log(`   before: ${before.n} appointments (${before.upcoming} upcoming)`);
    console.log(`   ADDING ${plan.planned.length}:`);
    for (const row of plan.planned) {
      console.log(
        `     ${row.localDay} ${row.localTime}  ${row.person.name.padEnd(14)} ${row.serviceName}`,
      );
    }

    if (!dryRun && plan.planned.length > 0) {
      await db.insert(appointments).values(
        plan.planned.map((row) => ({
          businessId: plan.business!.id,
          serviceId: row.serviceId,
          staffId: plan.staffId!,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: "confirmed" as const,
          clientName: row.person.name,
          clientPhone: row.person.phone,
          serviceName: row.serviceName,
          priceCents: row.priceCents,
          cancelToken: randomUUID(),
        })),
      );
      console.log(`   inserted ${plan.planned.length}.`);
    }
    console.log("");
  }

  if (dryRun) console.log("Run without --dry-run to insert.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
