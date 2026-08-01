import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@/test/pglite";
import {
  createAppointment,
  createAuthUser,
  createBusiness,
  createService,
  createShift,
} from "@/test/factories";

/**
 * Migration 0008. `businesses.owner_user_id` was a logical FK with nothing
 * enforcing it, so deleting an owner in Supabase Auth left the business behind
 * holding its UNIQUE slug — and the same person re-registering could never
 * reclaim it.
 *
 * Raw `harness.pg` queries rather than `db.execute` throughout: the shared
 * `Database` handle is driver-agnostic and returns an untyped result, while the
 * PGlite client is generic over the row shape.
 */
describe("owner deletion cascade", () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    harness = await createTestDb();
  });

  afterEach(async () => {
    await harness.close();
  });

  type Counts = {
    businesses: number;
    services: number;
    working_hours: number;
    appointments: number;
    notifications: number;
  };

  const countAll = async () => {
    const res = await harness.pg.query<Counts>(`
      SELECT
        (SELECT count(*)::int FROM businesses)    AS businesses,
        (SELECT count(*)::int FROM services)      AS services,
        (SELECT count(*)::int FROM working_hours) AS working_hours,
        (SELECT count(*)::int FROM appointments)  AS appointments,
        (SELECT count(*)::int FROM notifications) AS notifications
    `);
    return res.rows[0];
  };

  const slugs = async () => {
    const res = await harness.pg.query<{ slug: string }>(
      `SELECT slug FROM businesses ORDER BY slug`,
    );
    return res.rows.map((r) => r.slug);
  };

  it("refuses a business whose owner does not exist", async () => {
    await expect(
      harness.pg.query(
        `INSERT INTO businesses (owner_user_id, slug, name)
         VALUES (gen_random_uuid(), 'ghost-shop', 'רפאים')`,
      ),
    ).rejects.toThrow(/foreign key|businesses_owner_user_id_fkey/i);
  });

  it("removes the business and every child row when the owner is deleted", async () => {
    const ownerId = await createAuthUser(harness.db);
    const business = await createBusiness(harness.db, {
      ownerUserId: ownerId,
    });
    const service = await createService(harness.db, business.id);
    await createShift(harness.db, business.id, 0, "09:00", "17:00");

    const appointment = await createAppointment(
      harness.db,
      business.id,
      service.id,
      new Date("2026-09-06T09:00:00Z"),
      new Date("2026-09-06T09:30:00Z"),
    );

    await harness.pg.query(
      `INSERT INTO notifications
         (business_id, appointment_id, channel, kind, recipient, scheduled_for, dedupe_key)
       VALUES ($1, $2, 'email', 'reminder', 'client@example.test', now(), $3)`,
      [business.id, appointment.id, `reminder:${appointment.id}`],
    );

    expect(await countAll()).toEqual({
      businesses: 1,
      services: 1,
      working_hours: 1,
      appointments: 1,
      notifications: 1,
    });

    await harness.pg.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);

    // appointments.service_id is ON DELETE RESTRICT, so a cascade that reached
    // services before appointments would abort here rather than clean up.
    expect(await countAll()).toEqual({
      businesses: 0,
      services: 0,
      working_hours: 0,
      appointments: 0,
      notifications: 0,
    });
  });

  it("frees the slug so the same person can re-register and reclaim it", async () => {
    const firstOwner = await createAuthUser(harness.db);
    await createBusiness(harness.db, {
      ownerUserId: firstOwner,
      slug: "ron-barber",
    });

    // Re-registering with the same email mints a *new* uuid, which is why the
    // orphan used to be unreachable: no live account could ever own it.
    await harness.pg.query(`DELETE FROM auth.users WHERE id = $1`, [
      firstOwner,
    ]);
    const secondOwner = await createAuthUser(harness.db);

    const business = await createBusiness(harness.db, {
      ownerUserId: secondOwner,
      slug: "ron-barber",
    });

    expect(business.slug).toBe("ron-barber");
    expect(business.ownerUserId).toBe(secondOwner);
  });

  it("leaves other owners' businesses untouched", async () => {
    const doomed = await createAuthUser(harness.db);
    const survivor = await createAuthUser(harness.db);

    await createBusiness(harness.db, {
      ownerUserId: doomed,
      slug: "doomed-shop",
    });
    await createBusiness(harness.db, {
      ownerUserId: survivor,
      slug: "surviving-shop",
    });

    await harness.pg.query(`DELETE FROM auth.users WHERE id = $1`, [doomed]);

    expect(await slugs()).toEqual(["surviving-shop"]);
  });

  it("blocks the constraint when an orphan already exists", async () => {
    // Reproduce a pre-0008 database: drop the constraint, orphan a row, then
    // re-run what the migration does. Proves the migration fails loudly on a
    // dirty database rather than silently destroying the orphan.
    const ownerId = await createAuthUser(harness.db);
    await createBusiness(harness.db, {
      ownerUserId: ownerId,
      slug: "legacy-shop",
    });

    await harness.pg.query(
      `ALTER TABLE businesses DROP CONSTRAINT businesses_owner_user_id_fkey`,
    );
    await harness.pg.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);

    await expect(
      harness.pg.query(
        `ALTER TABLE businesses
           ADD CONSTRAINT businesses_owner_user_id_fkey
           FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE`,
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    // The orphan survives — nothing was silently destroyed.
    expect(await slugs()).toEqual(["legacy-shop"]);
  });
});
