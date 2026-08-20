import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/pglite";

const TABLES = [
  "appointments",
  "businesses",
  /*
   * A phone number next to a sentence somebody wrote about a named individual
   * — the most sensitive pairing in the schema, and the newest.
   */
  "client_profiles",
  "invoices",
  /*
   * Bare phone numbers with no name beside them — a list of people who asked a
   * business to stop contacting them. Leaking it would be worse than leaking
   * the client list it is derived from, because it also records the request.
   */
  "marketing_opt_outs",
  "notifications",
  /*
   * The one table here with no `business_id`, and therefore no owner policy to
   * write. RLS is enabled with **zero policies**, which denies everyone — the
   * server's service role bypasses RLS and is the only thing that should read
   * it. Listed rather than exempted: a platform-wide table is exactly the kind
   * that would otherwise be forgotten, and it holds the switch that decides
   * whether every client on the platform hears anything.
   */
  "platform_settings",
  /*
   * A push endpoint is not a credential, but it is a URL that lets whoever
   * holds it buzz somebody's phone. The anon key is public and a table without
   * RLS is readable by anyone who knows its name, so this one gets the same
   * owner policy as every other tenant table.
   */
  "push_subscriptions",
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
  /*
   * The queue (0024). One owner policy and no anon policy, like every other
   * tenant table — and it matters here in a particular way: the rows pair a
   * name with a phone number and a statement about when somebody is free, and
   * the public form that writes them goes through the server's service role, so
   * a client can join a queue without being able to read who else is in it.
   */
  "waitlist_entries",
  "working_hours",
];

/** Tables deliberately shipped with RLS on and *no* policy, denying everyone. */
const NO_POLICY_TABLES = [
  "platform_settings",
  "rate_limits",
  "subscription_events",
];

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
