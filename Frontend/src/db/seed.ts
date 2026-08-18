import dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "../lib/demo";
import * as schema from "./schema";
import { businesses, services, staff, workingHours } from "./schema";

dotenv.config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DIRECT_URL (or DATABASE_URL) is not set in .env.local.");
}

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

type ServiceSeed = {
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
};

type Shift = { start: string; end: string };

type StaffSeed = { name: string; title: string; color: string };

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
    ],
    staff: [
      { name: "ניר בלאק", title: "ספר בכיר", color: "indigo" },
      { name: "אבי כהן", title: "ספר", color: "emerald" },
    ],
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
        name: "פדיקור",
        description: "פדיקור רפואי כולל טיפול בעקבים.",
        durationMin: 45,
        priceCents: 15000,
      },
    ],
    // A single chair on purpose, so the two demos show both shapes of the
    // product: `demo-barber` has a team and asks the client who, this one has
    // one technician and never shows that step.
    staff: [{ name: "מאיה לוי", title: "מעצבת ציפורניים", color: "rose" }],
    // One continuous shift, starting later — a studio, not a walk-in shop.
    weekdayShifts: [{ start: "10:00:00", end: "19:00:00" }],
    friday: { start: "09:00:00", end: "13:00:00" },
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

async function seedTenant(tenant: TenantSeed, ownerUserId: string) {
  /**
   * Delete and insert **in one transaction**, so a failure cannot leave the
   * demo missing. The previous version deleted first and inserted second with
   * nothing wrapping them, so the first failed run took `demo-barber` offline —
   * the shop three landing-page CTAs link to — and left no trace of why.
   */
  await db.transaction(async (tx) => {
    // Idempotent: wipe this demo business first. Cascades to its child rows.
    await tx.delete(businesses).where(eq(businesses.slug, tenant.slug));

    const [business] = await tx
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
        // Pro so the demo shows the whole product. Branding is a Pro
        // entitlement, and a demo shop that cannot demo it is not much of one.
        planType: "pro",
        /**
         * Without this the dashboard bounces the owner straight into
         * `/dashboard/setup`: `requireBusiness()` treats a null here as "closed
         * the tab mid-flow" and puts them back. So a claimed demo looked like it
         * had no business at all — the owner was offered the create-a-business
         * wizard while already owning a fully configured shop.
         *
         * The seed builds services and hours itself, so onboarding genuinely is
         * complete; saying so is the accurate value, not a shortcut.
         */
        onboardingCompletedAt: new Date(),
      })
      .returning();

    await tx.insert(services).values(
      tenant.services.map((service, index) => ({
        businessId: business.id,
        ...service,
        sortOrder: index + 1,
      })),
    );

    await tx.insert(staff).values(
      tenant.staff.map((member, index) => ({
        businessId: business.id,
        ...member,
        sortOrder: index + 1,
      })),
    );

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

    const hourRows =
      5 * tenant.weekdayShifts.length + (tenant.friday ? 1 : 0) + 1;

    console.log(`✅ Seeded "${business.name}" at /${business.slug}`);
    console.log(
      `   ${tenant.services.length} services, ${hourRows} working-hour rows.`,
    );
  });
}

async function seed() {
  console.log("Seeding database...");
  try {
    // Resolved once, and *before* anything is deleted: a missing owner used to
    // surface as a failed insert after the delete had already landed.
    const ownerUserId = await resolveOwnerId();

    for (const tenant of TENANTS) {
      await seedTenant(tenant, ownerUserId);
    }

    console.log("\nRun `npm run db:claim -- <your-auth-user-uuid>` to take");
    console.log("ownership of demo-barber in the dashboard.");
  } catch (error) {
    console.error("Seed failed:", error);
    // Set the code rather than calling process.exit(1) here — exit() is
    // immediate and would kill the process before `finally` closes the pool.
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

seed();
