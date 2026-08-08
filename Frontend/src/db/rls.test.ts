import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/pglite";

const TABLES = [
  "appointments",
  "businesses",
  "invoices",
  "notifications",
  // No owner policy: rate_limits is infrastructure with no business_id, so
  // RLS is on with no policy at all — nothing but the app connection reads it.
  "rate_limits",
  "services",
  "staff",
  "staff_schedules",
  // Same posture as rate_limits, for a different reason: it holds raw provider
  // payloads that can carry billing addresses and card metadata, and an owner
  // has no reason to read the webhook stream at all.
  "subscription_events",
  "time_off",
  "working_hours",
];

/** Tables deliberately shipped with RLS on and *no* policy, denying everyone. */
const NO_POLICY_TABLES = ["rate_limits", "subscription_events"];

/** Tables that carry tenant data and therefore need an owner policy. */
const TENANT_TABLES = TABLES.filter((t) => !NO_POLICY_TABLES.includes(t));

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

    expect(res.rows.map((r) => r.tablename).sort()).toEqual(TENANT_TABLES);
    for (const row of res.rows) {
      expect(row.roles).toContain("authenticated");
    }
  });

  it("lets an owner read invoices but never write them", async () => {
    const res = await harness.pg.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'invoices'`,
    );

    // Every other tenant table grants FOR ALL because owners genuinely edit
    // those rows. Nobody edits their own invoices, and an owner who could
    // INSERT one could mark themselves paid.
    expect(res.rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("keeps the no-policy tables sealed rather than merely unpolicied", async () => {
    const res = await harness.pg.query<{ tablename: string; count: number }>(
      `SELECT tablename, count(*)::int AS count FROM pg_policies
       WHERE schemaname = 'public' GROUP BY tablename`,
    );
    const byTable = new Map(res.rows.map((r) => [r.tablename, r.count]));

    for (const table of NO_POLICY_TABLES) {
      // RLS on plus zero policies denies every role RLS applies to. A policy
      // appearing here later would silently open the table up.
      expect(byTable.get(table) ?? 0).toBe(0);
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
