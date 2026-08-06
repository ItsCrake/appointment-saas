import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEMO_SLUG } from "../lib/demo";
import * as schema from "./schema";
import { businesses, services, workingHours } from "./schema";

dotenv.config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DIRECT_URL (or DATABASE_URL) is not set in .env.local.");
}

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function seed() {
  console.log("Seeding database...");
  try {
    // Idempotent: wipe the demo business first. Cascades to its child rows.
    await db.delete(businesses).where(eq(businesses.slug, DEMO_SLUG));

    const [business] = await db
      .insert(businesses)
      .values({
        // Stand-in until Supabase Auth is wired up in Phase 3.
        ownerUserId: randomUUID(),
        slug: DEMO_SLUG,
        name: "מספרת ברקאי",
        description: "מספרה לגברים בלב תל אביב. תספורות, עיצוב זקן וטיפוח.",
        phone: "050-1234567",
        address: "דיזנגוף 100, תל אביב",
        timezone: "Asia/Jerusalem",
        locale: "he",
        slotIntervalMin: 15,
        bufferMin: 5,
        minNoticeMin: 60,
        maxAdvanceDays: 45,
        cancelWindowHours: 12,
        // Pro so the demo shows the whole product. Branding is a Pro
        // entitlement, and a demo shop that cannot demo it is not much of one.
        planType: "pro",
      })
      .returning();

    await db.insert(services).values([
      {
        businessId: business.id,
        name: "תספורת גבר",
        description: "תספורת מלאה כולל חפיפה וסידור.",
        durationMin: 30,
        priceCents: 7000,
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: "תספורת ילד",
        description: "תספורת לילדים עד גיל 12.",
        durationMin: 20,
        priceCents: 6000,
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: "עיצוב זקן",
        description: "עיצוב וקיצור זקן עם תער.",
        durationMin: 15,
        priceCents: 3000,
        sortOrder: 3,
      },
    ]);

    // Israeli work week: Sun–Thu full days, Fri short, Sat closed.
    // Sun–Thu is a split shift with a 13:00–14:00 break.
    await db.insert(workingHours).values([
      ...[0, 1, 2, 3, 4].flatMap((weekday) => [
        {
          businessId: business.id,
          weekday,
          startTime: "09:00:00",
          endTime: "13:00:00",
        },
        {
          businessId: business.id,
          weekday,
          startTime: "14:00:00",
          endTime: "19:00:00",
        },
      ]),
      {
        businessId: business.id,
        weekday: 5,
        startTime: "09:00:00",
        endTime: "14:00:00",
      },
      {
        businessId: business.id,
        weekday: 6,
        startTime: "00:00:00",
        endTime: "00:00:00",
        isClosed: true,
      },
    ]);

    console.log(`✅ Seeded "${business.name}" at /${business.slug}`);
    console.log("   3 services, 12 working-hour rows.");
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
