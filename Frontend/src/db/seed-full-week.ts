import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "../lib/demo";
import { enqueueBookingNotifications } from "../lib/notifications/enqueue";
import { makeRandom } from "./demo-data";
import { BLOCKING_STATUSES } from "./queries/appointments";
import { REFUSAL, suppressionFrom } from "./seed-safety";
import * as schema from "./schema";
import {
  appointments,
  businesses,
  services,
  staff,
  workingHours,
  type AppointmentStatus,
  type Business,
} from "./schema";

/**
 * A week with no gaps in it, for finding out what breaks at capacity.
 *
 * ---------------------------------------------------------------------------
 * **This is a load test, and the thing it loads is a messaging engine**, so the
 * first thing it does is refuse to run where messages could actually go out.
 * Every appointment here enqueues the same notification rows a real booking
 * does — that is the point, it is what puts Livi under volume — and every one
 * of them carries a phone number. Fabricated appointments for a hundred people
 * who never booked anything are spam if they ever reach a handset, and the
 * account that sends them does not usually get a second warning.
 *
 * So {@link assertCannotSend} runs first and aborts unless one of the two
 * guards is on — the master console toggle or `DISABLE_WHATSAPP_DISPATCH`,
 * combined by OR exactly as the dispatcher combines them. Not a comment, not
 * a convention: the script does not continue.
 *
 * **Numbers and addresses are unroutable by construction.** Addresses use
 * `example.com`, which RFC 2606 reserves precisely so that test data cannot
 * reach anybody. Numbers use an `05` prefix that is not an allocated Israeli
 * mobile block, so they satisfy `isValidPhone` — the app must treat them as
 * real — while having no subscriber behind them. That is defence in depth
 * behind the dispatch check, not a substitute for it.
 *
 * **Additive, and demo tenants only.** Nothing is deleted, and the slug list is
 * closed: a volume test that wipes a shop's diary, or fills a paying customer's
 * week with fictional clients, is a worse outcome than not running it.
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

/**
 * How far ahead to fill. Seven days from today, inclusive.
 *
 * `--days=N` narrows it, which is what makes a smoke test possible: one day is
 * a handful of rows through exactly the same insert and enqueue path as a full
 * week, so the path can be proved before a hundred rows are committed to it.
 */
const DAYS = (() => {
  const flag = process.argv.find((arg) => arg.startsWith("--days="));
  const value = flag ? Number(flag.slice("--days=".length)) : 7;
  return Number.isFinite(value) && value >= 1 && value <= 14 ? value : 7;
})();

/**
 * The shops this may touch.
 *
 * A closed list rather than a flag with a default, because the failure mode of
 * getting it wrong is a real shop's week filled with people who do not exist,
 * and every one of those rows would queue a message.
 */
const ALLOWED = [DEMO_SLUG, DEMO_NAILS_SLUG] as const;

/**
 * What share of the week is *not* an ordinary confirmed booking.
 *
 * Small on purpose: the point of the mix is to prove the calendar and the
 * outbox handle a packed view containing them, not to build a week made of
 * edge cases. Roughly one in eight is awaiting approval, and separately about
 * one slot in ten also carries a cancelled row underneath it.
 */
const PENDING_IN = 8;
const CANCELLED_IN = 10;

/**
 * Names for the fictional week.
 *
 * Deliberately ordinary and deliberately many: a packed calendar rendered with
 * six repeated names does not look like a full week, it looks like a bug, and
 * the whole reason to fill one is to see what a full week looks like.
 */
const FIRST_NAMES = [
  "עומר", "איתי", "אלון", "יונתן", "דניאל", "רועי", "נדב", "אורי",
  "מיה", "נועה", "עדי", "שירה", "דנה", "יעל", "רוני", "טל",
  "אביב", "ליאור", "שחר", "עידן", "מאור", "גיא", "אסף", "תומר",
  "הילה", "מור", "ספיר", "אורית", "קרן", "לירון", "עינב", "גל",
];

const LAST_NAMES = [
  "לוי", "כהן", "מזרחי", "ברקת", "אביטן", "פרץ", "גולן", "אזולאי",
  "שגב", "בן חיים", "דהן", "קסטיאל", "אוחיון", "אלבז", "נחום", "שרון",
];

/**
 * An unroutable mobile prefix in a valid shape.
 *
 * `isValidPhone` accepts `05` plus eight digits, and the app must treat these
 * as real numbers or the test proves nothing. `056` is not an allocated
 * Israeli mobile block, so the shape passes and the number goes nowhere.
 *
 * Worth stating plainly: a numbering plan is somebody else's document and can
 * change. The guarantee this script actually relies on is
 * {@link assertCannotSend}; this only means that a mistake there still has to
 * get past a number nobody answers.
 */
const UNROUTABLE_PREFIX = "056";

type Person = { name: string; phone: string; email: string };

function makePeople(random: () => number, count: number): Person[] {
  const people: Person[] = [];
  const seen = new Set<string>();

  for (let i = 0; people.length < count && i < count * 20; i++) {
    const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const name = `${first} ${last}`;
    if (seen.has(name)) continue;
    seen.add(name);

    // Sequential rather than random, so two people can never share a number —
    // the clients list keys on it, and a collision would read as one person
    // with twice the history.
    const serial = String(1_000_000 + people.length).slice(-7);
    people.push({
      name,
      phone: `${UNROUTABLE_PREFIX}${serial}`,
      // RFC 2606 reserves this domain so that test addresses cannot deliver.
      email: `test.${people.length}@example.com`,
    });
  }

  return people;
}

/** "HH:MM[:SS]" to minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Aborts unless a message physically cannot leave this machine.
 *
 * ---------------------------------------------------------------------------
 * **Both guards, and both are checked here rather than trusted.** The product
 * combines them by OR — either suppresses, neither can force sending back on —
 * so *one* of them being set is enough for the app. This asks for the same
 * thing the app would conclude, but out loud and before writing a single row,
 * because the cost of being wrong is measured in messages to strangers.
 *
 * Read live from the database rather than from a cached settings object: the
 * console toggle can be flipped between one run of this script and the next,
 * and the version that matters is the one in force right now.
 * ---------------------------------------------------------------------------
 */
async function assertCannotSend(): Promise<string> {
  const [platform] = await db.execute<{ disabled: boolean | null }>(
    sql`select whatsapp_dispatch_disabled as disabled from platform_settings limit 1`,
  );

  const reason = suppressionFrom({
    platformDisabled: platform?.disabled ?? null,
    envValue: process.env.DISABLE_WHATSAPP_DISPATCH,
  });

  if (reason) return reason;

  throw new Error(REFUSAL);
}

type Planned = {
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  person: Person;
  status: AppointmentStatus;
  localDay: string;
  localTime: string;
  /** A cancelled row sitting under a slot that was then rebooked. */
  overlay?: Planned;
};

async function planFor(slug: string, now: Date) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  if (!business) return { slug, business: null as Business | null, planned: [] };

  const timezone = business.timezone;

  const [activeServices, activeStaff, hours] = await Promise.all([
    db
      .select()
      .from(services)
      .where(
        and(eq(services.businessId, business.id), eq(services.isActive, true)),
      )
      .orderBy(asc(services.sortOrder)),
    db
      .select()
      .from(staff)
      .where(and(eq(staff.businessId, business.id), eq(staff.isActive, true)))
      .orderBy(asc(staff.sortOrder)),
    db.select().from(workingHours).where(eq(workingHours.businessId, business.id)),
  ]);

  if (activeServices.length === 0 || activeStaff.length === 0) {
    return { slug, business, planned: [] as Planned[] };
  }

  const from = new Date(now);
  const until = new Date(now.getTime() + DAYS * 86_400_000);

  /** Whatever already holds a slot, so nothing is planned on top of it. */
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

  const random = makeRandom(slug.length * 7919 + DAYS);
  const people = makePeople(random, 400);
  let nextPerson = 0;
  const take = () => people[nextPerson++ % people.length];

  const planned: Planned[] = [];
  for (let day = 0; day < DAYS; day++) {
    const at = new Date(now.getTime() + day * 86_400_000);
    const localDay = formatInTimeZone(at, timezone, "yyyy-MM-dd");
    const weekday = Number(formatInTimeZone(at, timezone, "i")) % 7;

    const windows = hours
      .filter((row) => row.weekday === weekday && !row.isClosed)
      .map((row) => ({
        from: toMinutes(row.startTime),
        to: toMinutes(row.endTime),
      }))
      .sort((a, b) => a.from - b.from);

    /**
     * **Packed per provider**, because that is what the constraint excludes on
     * and therefore what "no free slot" means in a shop with more than one
     * chair. Filling only the first provider's day would leave the others
     * completely empty and the week would not be full at all.
     */
    /**
     * **Packed per provider**, because that is what the constraint excludes on
     * and therefore what "no free slot" means in a shop with more than one
     * chair. Filling only the first provider's day would leave the others
     * completely empty and the week would not be full at all.
     */
    for (const provider of activeStaff) {
      for (const window of windows) {
        const dayStart = fromZonedTime(`${localDay}T00:00:00`, timezone);
        const at = (minute: number) =>
          new Date(dayStart.getTime() + minute * 60_000);
        const minuteOf = (instant: Date) =>
          Math.round((instant.getTime() - dayStart.getTime()) / 60_000);

        /** Everything already holding time for this provider, in order. */
        const obstacles = [
          ...existing.filter((row) => row.staffId === provider.id),
          ...planned
            .filter((row) => row.staffId === provider.id)
            .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
        ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

        // Nothing is booked into the past, so today starts from now.
        let cursor = Math.max(window.from, minuteOf(now) + 1);

        while (cursor < window.to) {
          const cursorAt = at(cursor);

          /**
           * **Step to the end of whatever is in the way, not by the length of
           * the service that did not fit.**
           *
           * The first cut advanced by the rejected candidate's duration, which
           * is an arbitrary number with no relationship to the obstacle — it
           * left ten- and fifteen-minute fragments all over the week and
           * sometimes jumped clean over free time. Measured at 86% capacity on
           * a script whose entire purpose is 100%.
           */
          const covering = obstacles.find(
            (row) => row.startsAt <= cursorAt && cursorAt < row.endsAt,
          );
          if (covering) {
            cursor = Math.max(cursor + 1, minuteOf(covering.endsAt));
            continue;
          }

          /**
           * How much room there is before the next thing starts. A service is
           * only eligible if it fits inside it — which is what fills the week
           * right up to each obstacle instead of around it.
           */
          const next = obstacles.find((row) => row.startsAt > cursorAt);
          const limit = Math.min(
            window.to,
            next ? minuteOf(next.startsAt) : window.to,
          );

          const fits = activeServices.filter(
            (service) => cursor + service.durationMin <= limit,
          );

          /**
           * Nothing fits the remaining hole. That is the one gap this script
           * cannot close: a twelve-minute space in a shop whose shortest
           * service is fifteen is not bookable by any real booking either, so
           * it is stepped over rather than filled with something fictional.
           */
          if (fits.length === 0) {
            cursor = limit;
            continue;
          }

          const service = fits[Math.floor(random() * fits.length)];
          const startsAt = at(cursor);
          const endsAt = new Date(
            startsAt.getTime() + service.durationMin * 60_000,
          );

          const row: Planned = {
            startsAt,
            endsAt,
            staffId: provider.id,
            serviceId: service.id,
            serviceName: service.name,
            priceCents: service.priceCents,
            person: take(),
            status:
              Math.floor(random() * PENDING_IN) === 0 ? "pending" : "confirmed",
            localDay,
            localTime: formatInTimeZone(startsAt, timezone, "HH:mm"),
          };

          /**
           * **A cancellation is an overlay, not a gap.**
           *
           * A cancelled row does not hold its slot — `BLOCKING_STATUSES`
           * excludes it — so writing one *instead of* a booking would leave a
           * hole in a week whose whole purpose is having none. Written
           * underneath instead: the slot was booked, cancelled, and taken by
           * somebody else, which is both what a real full week looks like and
           * the case the calendar has to render without drawing two cards on
           * top of each other.
           */
          if (Math.floor(random() * CANCELLED_IN) === 0) {
            row.overlay = {
              ...row,
              person: take(),
              status: "cancelled",
              overlay: undefined,
            };
          }

          planned.push(row);
          obstacles.push({ startsAt, endsAt });
          obstacles.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
          cursor += service.durationMin;
        }
      }
    }
  }
  planned.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { slug, business, planned };
}

function summarise(planned: Planned[]) {
  const rows = planned.flatMap((row) => (row.overlay ? [row, row.overlay] : [row]));
  const byStatus = new Map<string, number>();
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }

  const byDay = new Map<string, number>();
  for (const row of planned) {
    byDay.set(row.localDay, (byDay.get(row.localDay) ?? 0) + 1);
  }

  return { rows, byStatus, byDay };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  console.log(`Database: ${databaseUrl.replace(/:[^:@]*@/, ":****@")}`);

  const suppressedBy = await assertCannotSend();
  console.log(`WhatsApp dispatch suppressed by: ${suppressedBy}`);
  console.log(dryRun ? "DRY RUN — nothing will be written.\n" : "Inserting.\n");

  /** `--only=<slug>` narrows further, and still only within `ALLOWED`. */
  const onlyFlag = process.argv.find((arg) => arg.startsWith("--only="));
  const only = onlyFlag?.slice("--only=".length);
  const targets = only ? ALLOWED.filter((slug) => slug === only) : ALLOWED;

  if (targets.length === 0) {
    throw new Error(
      `--only=${only} is not one of the demo tenants (${ALLOWED.join(", ")}).`,
    );
  }

  for (const slug of targets) {
    const plan = await planFor(slug, now);

    if (!plan.business) {
      console.log(`/${slug} — not present, skipped.\n`);
      continue;
    }

    const [before] = await db.execute<{ n: number; upcoming: number }>(sql`
      select count(*)::int as n,
             count(*) filter (where starts_at >= now())::int as upcoming
      from appointments where business_id = ${plan.business.id}
    `);

    const { rows, byStatus, byDay } = summarise(plan.planned);

    console.log(`/${slug} — "${plan.business.name}"`);
    console.log(`   before: ${before.n} appointments (${before.upcoming} upcoming)`);
    console.log(`   ADDING ${rows.length} rows across ${byDay.size} open days:`);
    for (const [day, count] of [...byDay].sort()) {
      console.log(`     ${day}  ${String(count).padStart(2)} slots`);
    }
    console.log(
      `   statuses: ${[...byStatus].map(([s, c]) => `${s} ${c}`).join(", ")}`,
    );

    if (dryRun || rows.length === 0) {
      console.log("");
      continue;
    }

    /**
     * Inserted one at a time and enqueued as it lands, because the outbox is
     * the half being tested. `enqueueBookingNotifications` is the same call the
     * booking flow makes, so what ends up in `notifications` is what a real
     * week of bookings would put there — the volume this test exists to
     * produce.
     *
     * Nothing is dispatched here. The cron does that, and it will find every
     * one of these suppressed.
     */
    let queued = 0;
    for (const row of rows) {
      const [inserted] = await db
        .insert(appointments)
        .values({
          businessId: plan.business.id,
          serviceId: row.serviceId,
          staffId: row.staffId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          clientName: row.person.name,
          clientPhone: row.person.phone,
          clientEmail: row.person.email,
          serviceName: row.serviceName,
          priceCents: row.priceCents,
          cancelToken: randomUUID(),
          ...(row.status === "cancelled" ? { cancelledAt: new Date() } : {}),
        })
        .returning();

      // A cancelled row never announced itself, so it does not queue anything.
      if (row.status === "cancelled") continue;

      const sent = await enqueueBookingNotifications({
        db,
        business: plan.business,
        appointment: inserted,
      });
      queued += sent.length;
    }

    console.log(`   inserted ${rows.length}, queued ${queued} notification rows.\n`);
  }

  if (dryRun) console.log("Run without --dry-run to insert.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
