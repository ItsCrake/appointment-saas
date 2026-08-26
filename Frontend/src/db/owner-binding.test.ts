import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  claimPendingBusiness,
  createPendingBusiness,
  getBusinessByOwner,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { createAuthUser, createBusiness } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * Binding a shop to the owner it was created for (0028).
 *
 * ---------------------------------------------------------------------------
 * The operator sets a business up before its owner has an account, names the
 * address, and the binding completes on that person's first sign-in.
 *
 * Two properties carry the whole feature, and both are security properties
 * rather than conveniences: **a pending shop must never surface as the
 * operator's own**, and **a claim must be settled in one statement**, or two
 * tabs racing a first login could both believe they own it.
 * ---------------------------------------------------------------------------
 */

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

/**
 * An operator who already runs a shop of their own, which is the state that
 * makes the "does not appear as the operator's own" assertion meaningful.
 */
async function operator() {
  const seed = await createBusiness(db);
  return seed.ownerUserId;
}

/**
 * An invited owner: a real auth row and **no business**, which is exactly the
 * state a pilot is in on their first sign-in. Giving them a shop here would
 * make `getBusinessByOwner` return that one and quietly hide whether the claim
 * worked at all.
 */
async function invitee() {
  const id = randomUUID();
  await createAuthUser(db, id);
  return id;
}

describe("creating a shop for an owner who has no account yet", () => {
  it("does not appear as the operator's own business", async () => {
    /**
     * The single most important assertion here. The row *is* owned by the
     * operator in the column — that is what keeps RLS working without making
     * `owner_user_id` nullable — so the only thing standing between the
     * operator and a shop that is not theirs is the filter in
     * `getBusinessByOwner`.
     */
    const operatorId = await operator();

    await createPendingBusiness(db, {
      operatorUserId: operatorId,
      pendingOwnerEmail: "pilot@example.com",
      name: "מספרת פיילוט",
      slug: `pilot-${randomUUID().slice(0, 8)}`,
      phone: null,
    });

    const theirs = await getBusinessByOwner(db, operatorId);

    // The operator's own seeded shop, never the pending one.
    expect(theirs?.pendingOwnerEmail).toBeNull();
  });

  it("stores the address folded, so a claim cannot miss on capitalisation", async () => {
    const operatorId = await operator();

    const created = await createPendingBusiness(db, {
      operatorUserId: operatorId,
      pendingOwnerEmail: "  Pilot@Example.COM  ",
      name: "מספרת פיילוט",
      slug: `pilot-${randomUUID().slice(0, 8)}`,
      phone: null,
    });

    expect(created.pendingOwnerEmail).toBe("pilot@example.com");
  });
});

describe("claiming", () => {
  async function pending(operatorId: string, email: string) {
    return createPendingBusiness(db, {
      operatorUserId: operatorId,
      pendingOwnerEmail: email,
      name: "מספרת פיילוט",
      slug: `pilot-${randomUUID().slice(0, 8)}`,
      phone: null,
    });
  }

  it("transfers ownership and clears the flag in one write", async () => {
    const operatorId = await operator();
    const ownerId = await invitee();
    const created = await pending(operatorId, "pilot@example.com");

    const claimed = await claimPendingBusiness(
      db,
      ownerId,
      "pilot@example.com",
    );

    expect(claimed?.id).toBe(created.id);
    expect(claimed?.ownerUserId).toBe(ownerId);
    // Both halves, or the row is either ownerless or permanently pending.
    expect(claimed?.pendingOwnerEmail).toBeNull();

    // And now it resolves the ordinary way, which is the point of the feature.
    const theirs = await getBusinessByOwner(db, ownerId);
    expect(theirs?.id).toBe(created.id);
  });

  it("matches the address case-insensitively", async () => {
    const operatorId = await operator();
    const ownerId = await invitee();
    await pending(operatorId, "pilot@example.com");

    expect(
      (await claimPendingBusiness(db, ownerId, "PILOT@Example.com "))?.id,
    ).toBeTruthy();
  });

  it("cannot be claimed twice", async () => {
    /**
     * The race, settled in the WHERE clause rather than by reading first. The
     * second call matches zero rows because the first cleared the column in the
     * same statement that moved ownership — there is no window between them.
     */
    const operatorId = await operator();
    const first = await invitee();
    const second = await invitee();
    const created = await pending(operatorId, "pilot@example.com");

    const won = await claimPendingBusiness(db, first, "pilot@example.com");
    const lost = await claimPendingBusiness(db, second, "pilot@example.com");

    expect(won?.id).toBe(created.id);
    expect(lost).toBeNull();

    // The loser gets nothing, and the winner keeps it.
    expect((await getBusinessByOwner(db, second))?.id).not.toBe(created.id);
    expect((await getBusinessByOwner(db, first))?.id).toBe(created.id);
  });

  it("ignores an address nothing is waiting for", async () => {
    // The normal case for every sign-in the platform will ever serve.
    const ownerId = await invitee();
    expect(
      await claimPendingBusiness(db, ownerId, "nobody@example.com"),
    ).toBeNull();
  });

  it("refuses a blank address rather than matching a null column", async () => {
    /**
     * A user with no email must never sweep up a pending row. Guarded before
     * the query, because `lower(NULL) = ''` is NULL rather than false and the
     * shape of that comparison is exactly the kind of thing that changes
     * meaning when somebody rewrites the predicate.
     */
    const operatorId = await operator();
    const ownerId = await invitee();
    await pending(operatorId, "pilot@example.com");

    expect(await claimPendingBusiness(db, ownerId, "")).toBeNull();
    expect(await claimPendingBusiness(db, ownerId, "   ")).toBeNull();
  });

  it("keeps one address waiting for one shop only", async () => {
    // The partial unique index. Two pilots invited to the same address would
    // make "claim the business waiting for me" a question with two answers.
    const operatorId = await operator();
    await pending(operatorId, "pilot@example.com");

    await expect(pending(operatorId, "PILOT@example.com")).rejects.toThrow();
  });
});
