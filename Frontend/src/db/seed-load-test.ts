import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { and, asc, eq, gt, inArray, like, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import postgres from "postgres";

import { shiftDays, weekOf } from "../lib/calendar-week";
import { DEMO_SLUG, DEMO_SLUGS } from "../lib/demo";
import {
  atLocal,
  LOAD_TEST_PHONE_PREFIX,
  planLoadTest,
  type OpenWindow,
} from "./load-test-plan";
import { BLOCKING_STATUSES } from "./queries/appointments";
import { toDate } from "./queries/sql-types";
import * as schema from "./schema";
import {
  appointments,
  businesses,
  clientProfiles,
  marketingOptOuts,
  platformSettings,
  services,
  staff,
  staffSchedules,
  timeOff,
  waitlistEntries,
  workingHours,
  type Business,
} from "./schema";
import { suppressionFrom } from "./seed-safety";

/**
 * Books a demo shop solid for this week and next, and takes it all out again.
 *
 * ---------------------------------------------------------------------------
 *   npm run db:seed:load-test -- --dry-run     the plan, nothing written
 *   npm run db:seed:load-test                  insert it
 *   npm run db:purge:load-test                 what the purge would delete
 *   npm run db:purge:load-test -- --confirm    delete it
 *
 * `--slug=demo-nails` points either at the other demo; `demo-barber` is the
 * default. The plan itself is `load-test-plan.ts`.
 *
 * **Rows, not bookings — the opposite choice to `db:seed:full-week`, for the
 * opposite question.** That script books through the real actions because it
 * exists to test availability. This one exists to test the *calendar* at a
 * density the availability engine would never produce — back to back, five
 * minutes apart — so it writes the rows directly. The useful consequence is that
 * nothing here can queue a message: confirmations, reminders and waitlist offers
 * are all written to the outbox by those actions, and the cron only sends what
 * is already in the outbox. Writing an appointment row queues nothing.
 *
 * **So the guards check that this stays true rather than trusting it.** No
 * trigger on `appointments` (a Supabase database webhook is a trigger), no
 * `pg_cron` job that reads the table, and — as with every seeder here — WhatsApp
 * dispatch suppressed, because a pending row approved by hand later *does*
 * queue a real message. No email is stored and marketing consent is false, so
 * the channel walk and the win-back sweep both have nothing to reach.
 *
 * **One batch at a time.** It refuses while any `0560` row is already in the
 * shop, which is also what keeps the purge exact: the prefix names this batch
 * and nothing older.
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

/** Fixed, so a dry run and the run after it place the same fortnight. */
const SEED = 20260915;

/** What a barbershop sells most of. A service not named here weighs 1. */
const POPULARITY: Record<string, number> = {
  "תספורת גבר": 5,
  "תספורת + זקן": 3.5,
  "תספורת ילד": 2,
  "עיצוב זקן": 2,
  צבע: 1.2,
};

const PHONE_LIKE = `${LOAD_TEST_PHONE_PREFIX}%`;

function arg(name: string): string | undefined {
  const flag = process.argv.find((value) => value.startsWith(`--${name}=`));
  return flag?.slice(name.length + 3);
}

/** "HH:MM:SS" to minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

const inBatch = (business: Business) =>
  and(
    eq(appointments.businessId, business.id),
    like(appointments.clientPhone, PHONE_LIKE),
  );

async function seed(business: Business, dryRun: boolean) {
  const tz = business.timezone;

  console.log("Guards");
  const refusals: string[] = [];
  const check = (ok: boolean, line: string, refusal: string) => {
    console.log(`   ${ok ? "ok " : "NO "} ${line}`);
    if (!ok) refusals.push(refusal);
  };

  const [platform] = await db
    .select({ disabled: platformSettings.whatsappDispatchDisabled })
    .from(platformSettings)
    .limit(1);
  const suppressedBy = suppressionFrom({
    platformDisabled: platform?.disabled ?? null,
    envValue: process.env.DISABLE_WHATSAPP_DISPATCH,
  });
  check(
    Boolean(suppressedBy),
    `WhatsApp dispatch suppressed${suppressedBy ? ` (${suppressedBy})` : ""}`,
    "Turn WhatsApp dispatch off first — the /master toggle or DISABLE_WHATSAPP_DISPATCH=true.",
  );

  const [triggers] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from pg_trigger
    where tgrelid = 'public.appointments'::regclass and not tgisinternal`);
  check(
    triggers.n === 0,
    `no triggers on appointments (${triggers.n})`,
    "appointments has a trigger. A trigger can call out, so a row written here is not guaranteed silent.",
  );

  const [cron] = await db.execute<{ present: boolean }>(
    sql`select to_regclass('cron.job') is not null as present`,
  );
  let cronJobs = 0;
  if (cron.present) {
    const [jobs] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from cron.job where command ilike '%appointments%'`,
    );
    cronJobs = jobs.n;
  }
  check(
    cronJobs === 0,
    cron.present
      ? `no pg_cron job reads appointments (${cronJobs})`
      : "pg_cron not installed",
    "A pg_cron job reads appointments. Find out what it does before adding rows it will see.",
  );

  const [already] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(inBatch(business));
  check(
    already.n === 0,
    `no ${LOAD_TEST_PHONE_PREFIX} rows in /${business.slug} yet (${already.n})`,
    `A batch is already in. One at a time — preview the purge: npm run db:purge:load-test`,
  );

  if (refusals.length > 0) {
    console.log(`\nREFUSING:\n${refusals.map((r) => `   - ${r}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  // This week and next, Sunday to Saturday, on the shop's own calendar.
  const now = new Date();
  const thisWeek = weekOf(formatInTimeZone(now, tz, "yyyy-MM-dd"));
  const days = [...thisWeek, ...weekOf(shiftDays(thisWeek[0], 7))];
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, tz);
  const rangeEnd = fromZonedTime(`${shiftDays(days[13], 1)}T00:00:00`, tz);

  const [activeServices, team, hours, schedules, closures, live] =
    await Promise.all([
      db
        .select()
        .from(services)
        .where(
          and(
            eq(services.businessId, business.id),
            eq(services.isActive, true),
          ),
        )
        .orderBy(asc(services.sortOrder)),
      db
        .select()
        .from(staff)
        .where(and(eq(staff.businessId, business.id), eq(staff.isActive, true)))
        .orderBy(asc(staff.sortOrder)),
      db
        .select()
        .from(workingHours)
        .where(eq(workingHours.businessId, business.id)),
      db
        .select({ row: staffSchedules })
        .from(staffSchedules)
        .innerJoin(staff, eq(staff.id, staffSchedules.staffId))
        .where(eq(staff.businessId, business.id)),
      db
        .select()
        .from(timeOff)
        .where(
          and(
            eq(timeOff.businessId, business.id),
            lt(timeOff.startsAt, rangeEnd),
            gt(timeOff.endsAt, rangeStart),
          ),
        ),
      db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.businessId, business.id),
            lt(appointments.startsAt, rangeEnd),
            gt(appointments.endsAt, rangeStart),
            inArray(appointments.status, [...BLOCKING_STATUSES]),
          ),
        ),
    ]);

  if (activeServices.length === 0 || team.length === 0) {
    console.log("\nNo active service or provider — nothing to book.");
    process.exitCode = 1;
    return;
  }

  /** A provider's own schedule where they have one, the shop's hours where not. */
  const windowsFor = (staffId: string, weekday: number): OpenWindow[] => {
    const own = schedules
      .map(({ row }) => row)
      .filter((row) => row.staffId === staffId);
    const source =
      own.length > 0
        ? own.filter((row) => row.weekday === weekday)
        : hours.filter((row) => row.weekday === weekday && !row.isClosed);
    return source.map((row) => ({
      from: toMinutes(row.startTime),
      to: toMinutes(row.endTime),
    }));
  };

  const occupied = [
    ...live.map((a) => ({
      staffId: a.staffId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    })),
    ...closures.map((t) => ({
      staffId: t.staffId,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
    })),
  ];

  const rows = planLoadTest({
    timezone: tz,
    days,
    staffIds: team.map((member) => member.id),
    windowsFor,
    services: activeServices.map((service) => ({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      weight: POPULARITY[service.name] ?? 1,
      forChild: service.name.includes("ילד"),
    })),
    occupied,
    bufferMin: business.bufferMin,
    now,
    seed: SEED,
  });

  const label = (day: string) =>
    formatInTimeZone(new Date(`${day}T12:00:00Z`), tz, "EEE d.M");
  const when = (instant: Date) =>
    formatInTimeZone(instant, tz, "EEE d.M HH:mm");

  console.log(
    `\n/${business.slug} — "${business.name}" · ${tz} · ${team.length} provider(s) · buffer ${business.bufferMin}m`,
  );
  console.log(
    `Range: ${label(days[0])} → ${label(days[13])} (this week and next)\n`,
  );
  console.log(
    "   day          open   before  adding  pending  cancelled  widest hole",
  );

  for (const day of days) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const onDay = (instant: Date) =>
      formatInTimeZone(instant, tz, "yyyy-MM-dd") === day;

    let open = 0;
    let widest = 0;
    for (const member of team) {
      for (const window of windowsFor(member.id, weekday)) {
        open += window.to - window.from;
        const from = atLocal(day, window.from, tz);
        const to = atLocal(day, window.to, tz);
        const spans = [
          ...occupied.filter(
            (o) => o.staffId === null || o.staffId === member.id,
          ),
          ...rows.filter(
            (r) => r.staffId === member.id && r.status !== "cancelled",
          ),
        ]
          .map((s) => ({
            start: s.startsAt.getTime(),
            end: s.endsAt.getTime(),
          }))
          .filter((s) => s.start < to && s.end > from)
          .sort((a, b) => a.start - b.start);

        let cursor = from;
        for (const span of spans) {
          widest = Math.max(widest, span.start - cursor);
          cursor = Math.max(cursor, span.end);
        }
        widest = Math.max(widest, to - cursor);
      }
    }

    if (open === 0) {
      console.log(`   ${label(day).padEnd(11)}  closed`);
      continue;
    }

    const adding = rows.filter((r) => onDay(r.startsAt));
    const count = (status: string) =>
      adding.filter((r) => r.status === status).length;
    console.log(
      `   ${label(day).padEnd(11)} ${`${Math.floor(open / 60)}h${String(open % 60).padStart(2, "0")}`.padStart(6)}` +
        `${String(live.filter((a) => onDay(a.startsAt)).length).padStart(9)}` +
        `${String(adding.length - count("cancelled")).padStart(8)}` +
        `${String(count("pending")).padStart(9)}` +
        `${String(count("cancelled")).padStart(11)}` +
        `${`${Math.round(widest / 60_000)}m`.padStart(13)}`,
    );
  }

  const total = (status: string) =>
    rows.filter((row) => row.status === status).length;
  const origins = (via: string) =>
    rows.filter((row) => row.createdVia === via).length;

  console.log(
    `\n${dryRun ? "WOULD ADD" : "ADDING"} ${rows.length} appointments: ${total("confirmed")} confirmed, ${total("pending")} pending, ${total("cancelled")} cancelled`,
  );
  if (rows.length > 0) {
    console.log(
      `   first ${when(rows[0].startsAt)} · last ${when(rows[rows.length - 1].startsAt)}`,
    );
  }
  console.log(
    `   created via online ${origins("online")}, manual ${origins("manual")}, voice ${origins("voice")} · ` +
      `${rows.filter((row) => row.notes).length} with a note · ${new Set(rows.map((row) => row.clientPhone)).size} distinct clients`,
  );
  console.log(
    `   every phone ${LOAD_TEST_PHONE_PREFIX}xxxxxx · no email · no marketing consent · nothing queued`,
  );

  if (dryRun) {
    console.log(
      "\nDRY RUN — nothing written. Run without --dry-run to insert.",
    );
    return;
  }

  if (rows.length === 0) return;

  // One transaction: a clash anywhere writes nothing at all.
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 100) {
      await tx.insert(appointments).values(
        rows.slice(i, i + 100).map((row) => ({
          businessId: business.id,
          serviceId: row.serviceId,
          staffId: row.staffId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          clientName: row.clientName,
          clientPhone: row.clientPhone,
          clientEmail: null,
          notes: row.notes,
          serviceName: row.serviceName,
          priceCents: row.priceCents,
          cancelToken: randomUUID(),
          createdVia: row.createdVia,
          createdAt: row.createdAt,
          cancelledAt: row.cancelledAt,
          clientConsentedMarketing: false,
        })),
      );
    }
  });

  // Read back rather than trusted.
  const written = await db
    .select({ status: appointments.status, n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(inBatch(business))
    .groupBy(appointments.status);

  const [outbox] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from notifications n join appointments a on a.id = n.appointment_id
    where a.business_id = ${business.id} and a.client_phone like ${PHONE_LIKE}`);

  const [clashes] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from appointments a
    join appointments b
      on b.business_id = a.business_id and b.staff_id = a.staff_id and a.id < b.id
     and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
    where a.business_id = ${business.id}
      and a.status not in ('cancelled', 'completed', 'no_show')
      and b.status not in ('cancelled', 'completed', 'no_show')
      and a.starts_at < ${rangeEnd.toISOString()}::timestamptz
      and a.ends_at > ${rangeStart.toISOString()}::timestamptz`);

  console.log(
    `\nWritten: ${written.map((row) => `${row.n} ${row.status}`).join(", ")}` +
      ` · outbox rows for them: ${outbox.n} · overlapping live pairs in range: ${clashes.n}`,
  );
  console.log(
    "Undo: npm run db:purge:load-test  (preview; add -- --confirm to delete)",
  );
}

async function purge(business: Business, confirm: boolean) {
  const tz = business.timezone;

  const byStatus = await db
    .select({ status: appointments.status, n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(inBatch(business))
    .groupBy(appointments.status);
  const total = byStatus.reduce((sum, row) => sum + row.n, 0);

  const [span] = await db
    .select({
      first: sql<string | null>`min(${appointments.startsAt})`,
      last: sql<string | null>`max(${appointments.startsAt})`,
    })
    .from(appointments)
    .where(inBatch(business));

  const [outbox] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from notifications n join appointments a on a.id = n.appointment_id
    where a.business_id = ${business.id} and a.client_phone like ${PHONE_LIKE}`);

  // Only there if somebody used these clients in the dashboard since.
  const extra = {
    profiles: and(
      eq(clientProfiles.businessId, business.id),
      like(clientProfiles.clientPhone, PHONE_LIKE),
    ),
    waitlist: and(
      eq(waitlistEntries.businessId, business.id),
      like(waitlistEntries.clientPhone, PHONE_LIKE),
    ),
    optOuts: and(
      eq(marketingOptOuts.businessId, business.id),
      like(marketingOptOuts.clientPhone, PHONE_LIKE),
    ),
  };
  const n = sql<number>`count(*)::int`;
  const [[profiles], [waiting], [optOuts]] = await Promise.all([
    db.select({ n }).from(clientProfiles).where(extra.profiles),
    db.select({ n }).from(waitlistEntries).where(extra.waitlist),
    db.select({ n }).from(marketingOptOuts).where(extra.optOuts),
  ]);

  const first = toDate(span.first);
  const last = toDate(span.last);
  const when = (instant: Date | null) =>
    instant ? formatInTimeZone(instant, tz, "EEE d.M HH:mm") : "-";

  console.log(
    `/${business.slug} — load-test batch (client_phone like '${PHONE_LIKE}')`,
  );
  console.log(
    `   appointments: ${total}${total ? ` (${byStatus.map((row) => `${row.n} ${row.status}`).join(", ")})` : ""}, ${when(first)} → ${when(last)}`,
  );
  console.log(`   outbox rows for them: ${outbox.n} (deleted with them)`);
  console.log(
    `   client notes / waitlist entries / opt-outs on those numbers: ${profiles.n} / ${waiting.n} / ${optOuts.n}`,
  );

  if (total + profiles.n + waiting.n + optOuts.n === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  if (!confirm) {
    console.log(
      "\nNothing deleted. To delete exactly these: npm run db:purge:load-test -- --confirm",
    );
    return;
  }

  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(appointments)
      .where(inBatch(business))
      .returning({ id: appointments.id });
    const notes = await tx
      .delete(clientProfiles)
      .where(extra.profiles)
      .returning({ id: clientProfiles.id });
    const entries = await tx
      .delete(waitlistEntries)
      .where(extra.waitlist)
      .returning({ id: waitlistEntries.id });
    const opted = await tx
      .delete(marketingOptOuts)
      .where(extra.optOuts)
      .returning({ id: marketingOptOuts.id });
    return {
      rows: rows.length,
      notes: notes.length,
      entries: entries.length,
      opted: opted.length,
    };
  });

  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(inBatch(business));

  console.log(
    `\nDeleted ${removed.rows} appointments, ${removed.notes} client notes, ${removed.entries} waitlist entries, ${removed.opted} opt-outs. Left with the prefix: ${left.n}.`,
  );
}

async function main() {
  const slug = arg("slug") ?? DEMO_SLUG;
  if (!(DEMO_SLUGS as readonly string[]).includes(slug)) {
    throw new Error(`--slug must be one of ${DEMO_SLUGS.join(", ")}`);
  }

  console.log(`Database: ${databaseUrl.replace(/:[^:@]*@/, ":****@")}\n`);

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);
  if (!business) throw new Error(`/${slug} is not in this database.`);

  if (process.argv.includes("--purge")) {
    await purge(business, process.argv.includes("--confirm"));
  } else {
    await seed(business, process.argv.includes("--dry-run"));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
