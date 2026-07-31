import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    // Migrations run over the direct connection, not the pooler.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
  strict: true,
  verbose: true,
});
