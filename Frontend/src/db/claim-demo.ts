import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEMO_SLUG } from "../lib/demo";
import * as schema from "./schema";
import { businesses } from "./schema";

dotenv.config({ path: ".env.local", quiet: true });

/**
 * Points the seeded demo business at a real Supabase Auth user, so a freshly
 * registered owner can sign in and see populated data instead of an empty
 * dashboard.
 *
 *   npm run db:claim -- <email>
 *   npm run db:claim -- <user-uuid>
 *   npm run db:claim -- <email> --slug=other-shop
 *
 * Resolving an email needs SUPABASE_SERVICE_ROLE_KEY (admin API). A raw uuid —
 * copy it from Supabase → Authentication → Users — works without it.
 */
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DIRECT_URL (or DATABASE_URL) is not set in .env.local.");
}

const args = process.argv.slice(2);
const identifier = args.find((a) => !a.startsWith("--"));
const slugArg = args.find((a) => a.startsWith("--slug="));
const slug = slugArg ? slugArg.split("=")[1] : DEMO_SLUG;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserId(value: string): Promise<string> {
  if (UUID.test(value)) return value;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      `"${value}" is not a uuid, and looking up an email needs SUPABASE_SERVICE_ROLE_KEY.\n` +
        "Either add that key to .env.local, or pass the user id from\n" +
        "Supabase → Authentication → Users directly.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`Supabase admin lookup failed: ${error.message}`);

  const match = data.users.find(
    (user) => user.email?.toLowerCase() === value.toLowerCase(),
  );
  if (!match) throw new Error(`No Supabase user found with email "${value}".`);

  return match.id;
}

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function claim() {
  if (!identifier) {
    console.error("Usage: npm run db:claim -- <email|user-uuid> [--slug=...]");
    process.exitCode = 1;
    return;
  }

  try {
    const ownerUserId = await resolveUserId(identifier);

    const [updated] = await db
      .update(businesses)
      .set({ ownerUserId })
      .where(eq(businesses.slug, slug))
      .returning();

    if (!updated) {
      console.error(
        `No business with slug "${slug}". Run "npm run db:seed" first.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `✅ "${updated.name}" (/${updated.slug}) now belongs to ${ownerUserId}`,
    );
    console.log("   Sign in at /login and open /dashboard.");
  } catch (error) {
    console.error("Claim failed:", (error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

claim();
