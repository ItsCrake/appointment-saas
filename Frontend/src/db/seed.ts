import dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "../lib/demo";
import {
  cancelOneFutureBooking,
  generateDemoAppointments,
  type DemoClient,
} from "./demo-data";
import * as schema from "./schema";
import {
  appointments,
  businesses,
  clientProfiles,
  notifications,
  services,
  staff,
  waitlistEntries,
  workingHours,
} from "./schema";

dotenv.config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DIRECT_URL (or DATABASE_URL) is not set in .env.local.");
}

const databaseUrl: string = url;
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client, { schema });

type ServiceSeed = {
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
};

type Shift = { start: string; end: string };

type StaffSeed = { name: string; title: string; color: string };

type WaitlistSeed = {
  name: string;
  phone: string;
  /** Index into `services`, or null for "any service". */
  service: number | null;
  /** 0 = Sunday. Empty means any day. */
  days: number[];
  window: "morning" | "afternoon" | "evening" | "any";
  note: string | null;
};

type TenantSeed = {
  slug: string;
  name: string;
  description: string;
  phone: string;
  address: string;
  /** Minutes the booking grid snaps to. A nail studio runs longer treatments. */
  slotIntervalMin: number;
  bufferMin: number;
  services: ServiceSeed[];
  /**
   * The team.
   *
   * Seeded rather than added by hand, because it was hand-added before and
   * therefore not reproducible: `db:seed` cascades the tenant away and the
   * providers did not come back. The E2E suite depends on `demo-barber` having
   * **two** active providers — that is what makes the public flow four steps
   * instead of three — so a demo whose team exists only in one database is a
   * suite that breaks on any fresh environment.
   */
  staff: StaffSeed[];
  /** Sun–Thu shifts. Friday and Saturday follow the Israeli week below. */
  weekdayShifts: Shift[];
  friday: Shift | null;
  /**
   * Whether new public bookings arrive as requests.
   *
   * On for the nail studio and off for the barber, which is not a coin toss:
   * the E2E suite books against `demo-barber` and asserts a confirmed booking,
   * so turning it on there would break the suite. Off does not stop the seed
   * writing `pending` rows — the flag governs what *new* bookings become, and
   * the calendar's amber badge keys off the status — so both demos show the
   * pending treatment and only one demos the setting.
   */
  requiresApproval: boolean;
  /**
   * Everybody who books here.
   *
   * **One gender per tenant, deliberately.** A barbershop whose client list
   * reads half female is the detail that makes a screenshot look generated, and
   * a prospect looking at their own trade notices it before they notice
   * anything else. `demo-data.test.ts` holds both lists to it.
   */
  clients: DemoClient[];
  waitlist: WaitlistSeed[];
  /** Notes a client left on a booking — a few carry one. */
  bookingNotes: string[];
  /** What the shop knows about a couple of regulars, keyed by phone. */
  clientNotes: { phone: string; notes: string }[];
  /** Fixed per tenant, so a re-seed reproduces the same calendar. */
  randomSeed: number;
};

/**
 * Both demo tenants, from one shape.
 *
 * The nail studio is not decoration: a prospect encounters Bazman by receiving
 * a booking link, and a nail technician shown a barber's page has to imagine
 * the product rather than see it. The two deliberately differ in the things a
 * beauty prospect would check first — treatment lengths well past an hour, a
 * 30-minute grid rather than 15, and a later start — because a demo that is the
 * barber with the words swapped answers none of those questions.
 */
const TENANTS: TenantSeed[] = [
  {
    slug: DEMO_SLUG,
    name: "מספרת בלאק",
    description: "מספרה לגברים בלב תל אביב. תספורות, עיצוב זקן וטיפוח.",
    phone: "050-1234567",
    address: "דיזנגוף 100, תל אביב",
    slotIntervalMin: 15,
    bufferMin: 5,
    services: [
      {
        name: "תספורת גבר",
        description: "תספורת מלאה כולל חפיפה וסידור.",
        durationMin: 30,
        priceCents: 7000,
      },
      {
        name: "תספורת ילד",
        description: "תספורת לילדים עד גיל 12.",
        durationMin: 20,
        priceCents: 6000,
      },
      {
        name: "עיצוב זקן",
        description: "עיצוב וקיצור זקן עם תער.",
        durationMin: 15,
        priceCents: 3000,
      },
      {
        name: "תספורת + זקן",
        description: "תספורת מלאה ועיצוב זקן באותו תור.",
        durationMin: 45,
        priceCents: 9000,
      },
      {
        name: "צבע",
        description: "צביעת שיער או זקן, כולל שטיפה.",
        durationMin: 60,
        priceCents: 14000,
      },
    ],
    /**
     * One chair.
     *
     * It ran with two for a while, which made the public flow four steps and
     * split every busy hour on the calendar into two lanes. Both demos are
     * single-provider now, and the shape the team version showed — the "who
     * with?" step, the staff legend, per-person tinting — is reachable by
     * adding somebody on `/dashboard/staff`, which is how a real shop grows
     * into it anyway.
     *
     * The E2E helper handles either shape: `chooseProviderIfAsked` races the
     * picker, the sole-provider card and the details heading, so a single-staff
     * tenant simply falls through.
     */
    staff: [{ name: "ניר בלאק", title: "ספר בכיר", color: "indigo" }],
    requiresApproval: false,
    clients: [
      { name: "עומר לוי", phone: "0521100201" },
      { name: "דניאל כהן", phone: "0521100202" },
      { name: "איתי מזרחי", phone: "0521100203" },
      { name: "רועי שחר", phone: "0521100204" },
      { name: "אלון אברהם", phone: "0521100205" },
      { name: "גיא גולן", phone: "0521100206" },
      { name: "יונתן פרץ", phone: "0521100207" },
      { name: "נדב ביטון", phone: "0521100208" },
      { name: "אורי דהן", phone: "0521100209" },
      { name: "מתן שרון", phone: "0521100210" },
      { name: "עידו רוזן", phone: "0521100211" },
      { name: "ליאור אשכנזי", phone: "0521100212" },
      { name: "טל אזולאי", phone: "0521100213" },
      { name: "שקד חדד", phone: "0521100214" },
      { name: "בן צרפתי", phone: "0521100215" },
      { name: "עידן מלכה", phone: "0521100216" },
    ],
    waitlist: [
      {
        name: "אסף ברקוביץ",
        phone: "0521100301",
        service: 0,
        days: [0, 2],
        window: "evening",
        note: "אפשר גם ברגע האחרון",
      },
      {
        name: "יובל נחום",
        phone: "0521100302",
        service: null,
        days: [],
        window: "any",
        note: null,
      },
      {
        name: "רון סלע",
        phone: "0521100303",
        service: 3,
        days: [1, 3],
        window: "morning",
        note: null,
      },
      {
        name: "עמית פישר",
        phone: "0521100304",
        service: 2,
        days: [4],
        window: "afternoon",
        note: "עובד באזור, יכול לקפוץ",
      },
      {
        name: "ניב הראל",
        phone: "0521100305",
        service: null,
        days: [0, 1, 2, 3, 4],
        window: "evening",
        note: null,
      },
    ],
    bookingNotes: [
      "אפשר לקצר קצת בצדדים",
      "מגיע עם הבן, תספורת גם לו",
      "בלי מכונה בבקשה",
      "ממהר, אם אפשר להקדים",
    ],
    clientNotes: [
      { phone: "0521100201", notes: "מעדיף מספריים בלבד, בלי מכונה." },
      { phone: "0521100204", notes: "תמיד מאחר בעשר דקות. שווה להתקשר לפני." },
      { phone: "0521100206", notes: "רגיש לצבע — לבדוק לפני כל צביעה." },
    ],
    randomSeed: 20260818,
    // A split shift with a 13:00–14:00 break.
    weekdayShifts: [
      { start: "09:00:00", end: "13:00:00" },
      { start: "14:00:00", end: "19:00:00" },
    ],
    friday: { start: "09:00:00", end: "14:00:00" },
  },
  {
    slug: DEMO_NAILS_SLUG,
    name: "סטודיו ציפורניים של מאיה",
    description:
      "בניית ולק ג׳ל, מניקור ופדיקור. סטודיו בוטיק ברמת גן, בתיאום מראש בלבד.",
    phone: "052-7654321",
    address: "ביאליק 24, רמת גן",
    // 30 rather than 15: every treatment here is at least 45 minutes, so a
    // quarter-hour grid would offer starts no appointment can ever use.
    slotIntervalMin: 30,
    // Longer than the barber's 5 — acetone, filing and cleanup between clients
    // is real time the calendar has to hold back.
    bufferMin: 10,
    services: [
      {
        name: "בניית ציפורניים",
        description: "בנייה בג׳ל או אקריל, כולל עיצוב וצורה.",
        durationMin: 120,
        priceCents: 25000,
      },
      {
        name: "מילוי",
        description: "מילוי לבנייה קיימת עד שלושה שבועות.",
        durationMin: 90,
        priceCents: 18000,
      },
      {
        name: "לק ג׳ל",
        description: "לק ג׳ל על הציפורן הטבעית, כולל הסרה.",
        durationMin: 60,
        priceCents: 12000,
      },
      {
        name: "פדיקור רפואי",
        description: "פדיקור רפואי כולל טיפול בעקבים.",
        durationMin: 45,
        priceCents: 15000,
      },
      {
        name: "מילוי באקריליק",
        description: "מילוי לבנייה באקריל, כולל עיצוב מחדש.",
        durationMin: 90,
        priceCents: 19000,
      },
    ],
    // A single chair on purpose, so the two demos show both shapes of the
    // product: `demo-barber` has a team and asks the client who, this one has
    // one technician and never shows that step.
    staff: [{ name: "מאיה לוי", title: "מעצבת ציפורניים", color: "rose" }],
    // One continuous shift, starting later — a studio, not a walk-in shop.
    weekdayShifts: [{ start: "10:00:00", end: "19:00:00" }],
    friday: { start: "09:00:00", end: "13:00:00" },
    /**
     * On here, and off at the barber. One chair means every booking is the
     * technician's whole afternoon, which is exactly the shop that vets
     * requests — and it is the tenant with no E2E dependency, so it is the one
     * that can demonstrate the setting.
     */
    requiresApproval: true,
    clients: [
      { name: "נועה לוי", phone: "0531100201" },
      { name: "שירן כהן", phone: "0531100202" },
      { name: "מאי גולן", phone: "0531100203" },
      { name: "יובל אברהם", phone: "0531100204" },
      { name: "עדי מזרחי", phone: "0531100205" },
      { name: "רוני שחר", phone: "0531100206" },
      { name: "טליה בן דוד", phone: "0531100207" },
      { name: "ליאור פרץ", phone: "0531100208" },
      { name: "הילה אזולאי", phone: "0531100209" },
      { name: "מיכל דהן", phone: "0531100210" },
      { name: "שני רוזן", phone: "0531100211" },
      { name: "אורטל ביטון", phone: "0531100212" },
      { name: "דנה מלכה", phone: "0531100213" },
      { name: "ספיר חדד", phone: "0531100214" },
    ],
    waitlist: [
      {
        name: "אלינור שגב",
        phone: "0531100301",
        service: 2,
        days: [0, 1],
        window: "morning",
        note: "גמישה בשעות",
      },
      {
        name: "קרן אלמוג",
        phone: "0531100302",
        service: null,
        days: [],
        window: "any",
        note: null,
      },
      {
        name: "תמר וקנין",
        phone: "0531100303",
        service: 0,
        days: [3, 4],
        window: "afternoon",
        note: null,
      },
      {
        name: "יעל שטרן",
        phone: "0531100304",
        service: 4,
        days: [2],
        window: "evening",
        note: "מחכה לתור אחרי העבודה",
      },
    ],
    bookingNotes: [
      "אפשר בבקשה צבע עדין",
      "יש לי אלרגיה לאצטון",
      "מגיעה אחרי העבודה, אולי באיחור קל",
    ],
    clientNotes: [
      { phone: "0531100201", notes: "אוהבת גוונים בהירים. רגישה בעור סביב הציפורן." },
      { phone: "0531100205", notes: "מעדיפה את הכיסא ליד החלון." },
    ],
    randomSeed: 20260819,
  },
];

/**
 * An `auth.users` id to hang the demo businesses on.
 *
 * `businesses.owner_user_id` has a foreign key to `auth.users`, so the original
 * `randomUUID()` placeholder — written before Supabase Auth existed — cannot
 * satisfy it. That made `db:seed` **destructive**: it deleted the demo shop and
 * then failed to recreate it, which is exactly what happened the first time
 * this file was run after the constraint landed.
 *
 * Preference order, and the middle one is the important one: an owner who
 * currently owns nothing. Attaching the demo to an account that already has a
 * business would put a fabricated shop in a real person's dashboard, and
 * `getBusinessByOwner` returns one row.
 */
async function resolveOwnerId(): Promise<string> {
  const override = process.env.SEED_OWNER_USER_ID?.trim();
  if (override) return override;

  const [free] = await db.execute<{ id: string }>(sql`
    select u.id from auth.users u
    left join businesses b on b.owner_user_id = u.id
    where b.id is null
    order by u.created_at
    limit 1
  `);
  if (free) return free.id;

  const [any] = await db.execute<{ id: string }>(
    sql`select id from auth.users order by created_at limit 1`,
  );
  if (any) {
    console.warn(
      "⚠ Every auth user already owns a business; reusing the oldest.\n" +
        "  Set SEED_OWNER_USER_ID to choose one deliberately.",
    );
    return any.id;
  }

  throw new Error(
    "No rows in auth.users, so a demo business cannot satisfy " +
      "businesses_owner_user_id_fkey. Sign up once at /login first, or set " +
      "SEED_OWNER_USER_ID.",
  );
}

/**
 * Who this demo should belong to after the re-seed.
 *
 * ---------------------------------------------------------------------------
 * **The current owner keeps it.** Re-seeding is a content refresh, not a
 * transfer, and `resolveOwnerId` answers a different question — who should own a
 * demo that does not exist yet. On a database where every account already owns
 * something it falls through to "reuse the oldest", which would hand *both*
 * demos to one account and leave whoever owned the other one staring at the
 * setup wizard, because `getBusinessByOwner` returns a single row.
 *
 * That is not hypothetical: it is exactly the state this project's database was
 * in when the demo data was first generated — three accounts, three businesses,
 * none free.
 * ---------------------------------------------------------------------------
 */
async function ownerFor(slug: string, fallback: string): Promise<string> {
  const [existing] = await db
    .select({ ownerUserId: businesses.ownerUserId })
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return existing?.ownerUserId ?? fallback;
}

async function seedTenant(tenant: TenantSeed, fallbackOwnerId: string) {
  const ownerUserId = await ownerFor(tenant.slug, fallbackOwnerId);

  /**
   * Delete and insert **in one transaction**, so a failure cannot leave the
   * demo missing. The previous version deleted first and inserted second with
   * nothing wrapping them, so the first failed run took `demo-barber` offline —
   * the shop three landing-page CTAs link to — and left no trace of why.
   */
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.slug, tenant.slug))
      .limit(1);

    /**
     * ---------------------------------------------------------------------
     * **A re-seed refreshes the diary, not the shop.**
     *
     * This used to delete the business row and let the cascade take everything
     * with it, which destroyed work nobody could get back: the logo, the hero
     * image, the gallery, the reviews, per-service and per-staff photos, and
     * whatever the description had been rewritten to. Those are uploads and
     * copy somebody made deliberately; appointments are generated fiction.
     *
     * So an existing tenant keeps its row and its children, and only the
     * **operational** data is cleared and rebuilt. What still gets written is
     * the handful of flags the demo's behaviour depends on — the plan, the
     * approval mode, the booking grid — because those are what the seed exists
     * to set and none of them is anybody's uploaded work.
     * ---------------------------------------------------------------------
     */
    const business = existing
      ? (
          await tx
            .update(businesses)
            .set({
              planType: "pro",
              requiresApproval: tenant.requiresApproval,
              slotIntervalMin: tenant.slotIntervalMin,
              bufferMin: tenant.bufferMin,
              isActive: true,
              onboardingCompletedAt:
                existing.onboardingCompletedAt ?? new Date(),
            })
            .where(eq(businesses.id, existing.id))
            .returning()
        )[0]
      : (
          await tx
            .insert(businesses)
            .values({
              ownerUserId,
              slug: tenant.slug,
              name: tenant.name,
              description: tenant.description,
              phone: tenant.phone,
              address: tenant.address,
              timezone: "Asia/Jerusalem",
              locale: "he",
              slotIntervalMin: tenant.slotIntervalMin,
              bufferMin: tenant.bufferMin,
              minNoticeMin: 60,
              maxAdvanceDays: 45,
              cancelWindowHours: 12,
              requiresApproval: tenant.requiresApproval,
              // Pro so the demo shows the whole product. Branding is a Pro
              // entitlement, and a demo shop that cannot demo it is not much
              // of one.
              planType: "pro",
              /**
               * Without this the dashboard bounces the owner straight into
               * `/dashboard/setup`: `requireBusiness()` treats a null here as
               * "closed the tab mid-flow" and puts them back.
               */
              onboardingCompletedAt: new Date(),
            })
            .returning()
        )[0];

    /**
     * The operational data, and only that: the diary, the queue, the client
     * notes and the outbox. Ordered so nothing is deleted while something else
     * still points at it — notifications reference both appointments and
     * waitlist entries.
     */
    await tx
      .delete(notifications)
      .where(eq(notifications.businessId, business.id));
    await tx
      .delete(waitlistEntries)
      .where(eq(waitlistEntries.businessId, business.id));
    await tx
      .delete(clientProfiles)
      .where(eq(clientProfiles.businessId, business.id));
    await tx
      .delete(appointments)
      .where(eq(appointments.businessId, business.id));

    /**
     * The catalogue, the team and the hours are **kept if they are already
     * there**, and created only for a tenant that has none.
     *
     * `services.image_url` and `staff.image_url` are uploads too, so recreating
     * these rows would throw away pictures for the same reason deleting the
     * business row threw away the logo. It also means an owner who renamed a
     * service or added somebody keeps that, and the generated diary simply
     * books whatever the shop actually offers.
     */
    let serviceRows = await tx
      .select()
      .from(services)
      .where(eq(services.businessId, business.id));

    if (serviceRows.length === 0) {
      serviceRows = await tx
        .insert(services)
        .values(
          tenant.services.map((service, index) => ({
            businessId: business.id,
            ...service,
            sortOrder: index + 1,
          })),
        )
        .returning();
    }

    let staffRows = await tx
      .select()
      .from(staff)
      .where(eq(staff.businessId, business.id));

    if (staffRows.length === 0) {
      staffRows = await tx
        .insert(staff)
        .values(
          tenant.staff.map((member, index) => ({
            businessId: business.id,
            ...member,
            sortOrder: index + 1,
          })),
        )
        .returning();
    }

    const existingHours = await tx
      .select()
      .from(workingHours)
      .where(eq(workingHours.businessId, business.id));

    if (existingHours.length === 0) {
      // Israeli work week: Sun–Thu, Fri short, Sat closed.
      await tx.insert(workingHours).values([
        ...[0, 1, 2, 3, 4].flatMap((weekday) =>
          tenant.weekdayShifts.map((shift) => ({
            businessId: business.id,
            weekday,
            startTime: shift.start,
            endTime: shift.end,
          })),
        ),
        ...(tenant.friday
          ? [
              {
                businessId: business.id,
                weekday: 5,
                startTime: tenant.friday.start,
                endTime: tenant.friday.end,
              },
            ]
          : []),
        {
          businessId: business.id,
          weekday: 6,
          startTime: "00:00:00",
          endTime: "00:00:00",
          isClosed: true,
        },
      ]);
    }

    /**
     * The diary is generated against the hours the shop **actually** keeps,
     * read back rather than assumed from the seed definition — otherwise a
     * tenant whose owner changed their opening times would get a month of
     * bookings outside them.
     */
    const shiftsByWeekday = new Map<number, Shift[]>();
    for (const row of existingHours.length > 0
      ? existingHours
      : await tx
          .select()
          .from(workingHours)
          .where(eq(workingHours.businessId, business.id))) {
      if (row.isClosed) continue;
      const list = shiftsByWeekday.get(row.weekday) ?? [];
      list.push({ start: row.startTime, end: row.endTime });
      shiftsByWeekday.set(row.weekday, list);
    }

    /* ---- The part that makes it look like a shop somebody runs --------- */

    const now = new Date();

    /**
     * Generated *after* the rows above, because it needs their real ids — and
     * inside the same transaction, so a demo can never end up with a calendar
     * hanging off a business that failed to insert.
     */
    const generated = generateDemoAppointments({
      businessId: business.id,
      timezone: "Asia/Jerusalem",
      services: serviceRows.map((service) => ({
        id: service.id,
        name: service.name,
        durationMin: service.durationMin,
        priceCents: service.priceCents,
      })),
      staffIds: staffRows.map((member) => member.id),
      shiftsForWeekday: (weekday) => shiftsByWeekday.get(weekday) ?? [],
      clients: tenant.clients,
      bufferMin: tenant.bufferMin,
      now,
      slotIntervalMin: tenant.slotIntervalMin,
      seed: tenant.randomSeed,
      notes: tenant.bookingNotes,
      requiresApproval: tenant.requiresApproval,
    });

    // One of them cancelled an hour ago, so a fresh opening — and the queue
    // reacting to it — is visible in a screenshot rather than described in one.
    await tx.insert(appointments).values(cancelOneFutureBooking(generated, now));

    await tx.insert(waitlistEntries).values(
      tenant.waitlist.map((person) => ({
        businessId: business.id,
        clientName: person.name,
        clientPhone: person.phone,
        serviceId:
          person.service === null ? null : serviceRows[person.service].id,
        preferredStaffId: null,
        preferredDays: person.days,
        preferredTimeWindow: person.window,
        notes: person.note,
        // Staggered, so the queue has an order somebody can reason about —
        // `matchesForSlot` offers the longest wait first.
        createdAt: new Date(now.getTime() - (person.days.length + 1) * 86_400_000),
      })),
    );

    await tx.insert(clientProfiles).values(
      tenant.clientNotes.map((profile) => ({
        businessId: business.id,
        clientPhone: profile.phone,
        notes: profile.notes,
      })),
    );

    const upcoming = generated.filter(
      (row) => row.startsAt > now && row.status !== "cancelled",
    ).length;

    console.log(`✅ Seeded "${business.name}" at /${business.slug}`);
    console.log(
      `   ${serviceRows.length} services, ${staffRows.length} staff` +
        `${existing ? " (kept, with their images)" : ""}.`,
    );
    console.log(
      `   ${generated.length} appointments (${upcoming} still ahead), ` +
        `${tenant.waitlist.length} waiting, ${tenant.clientNotes.length} client notes.`,
    );
  });
}

/**
 * What is there now, and what would be destroyed.
 *
 * ---------------------------------------------------------------------------
 * **`db:seed` deletes a whole tenant and everything hanging off it** — every
 * appointment, every client note, the queue, the lot — and it resolves the
 * owner from `auth.users`, so pointing it at the wrong `.env.local` is a
 * plausible mistake with an implausible cost.
 *
 * So the counts come first and the write is a separate, deliberate command.
 * Run with `--dry-run` this reports and exits having touched nothing.
 * ---------------------------------------------------------------------------
 */
async function preview(): Promise<void> {
  console.log(`Database: ${databaseUrl.replace(/:[^:@]*@/, ":****@")}\n`);

  for (const tenant of TENANTS) {
    const [existing] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.slug, tenant.slug))
      .limit(1);

    if (!existing) {
      console.log(`/${tenant.slug} — not present. Nothing to delete.`);
      continue;
    }

    const [counts] = await db.execute<{
      appointments: number;
      waitlist: number;
      profiles: number;
      notifications: number;
    }>(sql`
      select
        (select count(*) from appointments where business_id = ${existing.id})::int as appointments,
        (select count(*) from waitlist_entries where business_id = ${existing.id})::int as waitlist,
        (select count(*) from client_profiles where business_id = ${existing.id})::int as profiles,
        (select count(*) from notifications where business_id = ${existing.id})::int as notifications
    `);

    const [owner] = await db.execute<{ email: string | null }>(
      sql`select email from auth.users where id = ${existing.ownerUserId}`,
    );

    console.log(`/${tenant.slug} — "${existing.name}":`);
    console.log(
      `   owner stays ${owner?.email ?? existing.ownerUserId} (re-seed does not transfer)`,
    );
    console.log(
      `   KEPT: logo, hero media, gallery (${(existing.galleryUrls ?? []).length} images), ` +
        `reviews, theme, name, description, contact, services and staff with their images`,
    );
    console.log("   REPLACED:");
    console.log(
      `   ${counts.appointments} appointments, ${counts.waitlist} waitlist entries,`,
    );
    console.log(
      `   ${counts.profiles} client notes, ${counts.notifications} notification rows`,
    );
  }

  console.log(
    "\nOnly the operational rows above are replaced. Uploads and settings stay.",
  );
  console.log("Run without --dry-run to proceed.");
}

async function seed() {
  console.log("Seeding database...");
  try {
    /**
     * Resolved once, and *before* anything is deleted: a missing owner used to
     * surface as a failed insert after the delete had already landed.
     *
     * Only a *fallback* now — a demo that already exists keeps the account it
     * belongs to. See `ownerFor`.
     */
    const fallbackOwnerId = await resolveOwnerId();

    for (const tenant of TENANTS) {
      await seedTenant(tenant, fallbackOwnerId);
    }

    console.log("\nRun `npm run db:claim -- <your-auth-user-uuid>` to take");
    console.log("ownership of demo-barber in the dashboard.");
  } catch (error) {
    console.error("Seed failed:", error);
    // Set the code rather than calling process.exit(1) here — exit() is
    // immediate and would kill the process before `main` closes the pool.
    process.exitCode = 1;
  }
}

/**
 * Nothing is written unless the run says so.
 *
 * A dry run is the default *shape* of the conversation rather than the default
 * behaviour — `db:seed` has always written — but the preview is one flag away
 * and the destructive path prints the same counts before it starts.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  try {
    if (dryRun) {
      await preview();
      return;
    }

    await preview();
    console.log("");
    await seed();
  } finally {
    await client.end();
  }
}

main();
