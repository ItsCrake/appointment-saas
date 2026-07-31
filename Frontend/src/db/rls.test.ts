import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/pglite";

const TABLES = [
  "appointments",
  "businesses",
  "notifications",
  "services",
  "time_off",
  "working_hours",
];

let harness: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  harness = await createTestDb();
});

afterAll(async () => {
  await harness.close();
});

describe("row level security", () => {
  it("is enabled on every public table", async () => {
    const res = await harness.pg.query<{
      tablename: string;
      rowsecurity: boolean;
    }>(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`,
    );

    const unprotected = res.rows
      .filter((r) => !r.rowsecurity)
      .map((r) => r.tablename);

    expect(unprotected).toEqual([]);
    expect(res.rows.map((r) => r.tablename).sort()).toEqual(TABLES);
  });

  it("grants the authenticated role an owner policy on every table", async () => {
    const res = await harness.pg.query<{ tablename: string; roles: string }>(
      `SELECT tablename, roles::text FROM pg_policies WHERE schemaname = 'public'`,
    );

    expect(res.rows.map((r) => r.tablename).sort()).toEqual(TABLES);
    for (const row of res.rows) {
      expect(row.roles).toContain("authenticated");
    }
  });

  it("gives the anon role no policy at all, so PostgREST denies it", async () => {
    const res = await harness.pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_policies
       WHERE schemaname = 'public' AND roles::text LIKE '%anon%'`,
    );

    expect(res.rows[0].count).toBe(0);
  });
});
