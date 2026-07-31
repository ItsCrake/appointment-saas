import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

dotenv.config({ path: ".env.local", quiet: true });

// Migrations deliberately do NOT reuse the client from ./index: that one points
// at the transaction-mode pooler (port 6543), which cannot hold the advisory
// lock and multi-statement transaction the migrator needs. DDL goes over the
// direct/session connection instead, on a single serial connection.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DIRECT_URL (or DATABASE_URL) is not set. Check Frontend/.env.local.",
  );
}

const connection = postgres(url, { max: 1 });

async function main() {
  console.log("Running migrations...");
  try {
    await migrate(drizzle(connection), {
      migrationsFolder: "./src/db/migrations",
    });
    console.log("✅ Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    // Not process.exit(1): that would abort `finally` before the pool closes.
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
