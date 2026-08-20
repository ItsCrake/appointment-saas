import { and, asc, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";

import {
  appointments,
  services,
  staff,
  waitlistEntries,
  type WaitlistStatus,
} from "../schema";
import type { Database } from "../types";

/** Entries still in the queue: waiting, or offered something and not yet booked. */
export const LIVE_WAITLIST_STATUSES = ["active", "notified"] as const;

/**
 * Joins a client to the queue, or updates the place they already hold.
 *
 * ---------------------------------------------------------------------------
 * **Joining twice is not an error, it is a correction.** A partial unique index
 * allows one live entry per phone per shop, so somebody who taps "join" again —
 * because they forgot, or because their availability changed — would otherwise
 * hit a constraint violation and be shown a failure for doing something
 * reasonable. Updating the live row instead means the last thing they told the
 * shop is what the shop matches on, and they keep their **original**
 * `created_at`, so correcting a preference does not send them to the back of a
 * queue they have been in for a fortnight.
 * ---------------------------------------------------------------------------
 */
export async function upsertWaitlistEntry(
  db: Database,
  values: {
    businessId: string;
    clientName: string;
    clientPhone: string;
    serviceId: string | null;
    preferredStaffId: string | null;
    preferredDays: number[];
    preferredTimeWindow: "morning" | "afternoon" | "evening" | "any";
    notes: string | null;
  },
) {
  const [existing] = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.businessId, values.businessId),
        eq(waitlistEntries.clientPhone, values.clientPhone),
        inArray(waitlistEntries.status, [...LIVE_WAITLIST_STATUSES]),
      ),
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(waitlistEntries)
      .set({
        clientName: values.clientName,
        serviceId: values.serviceId,
        preferredStaffId: values.preferredStaffId,
        preferredDays: values.preferredDays,
        preferredTimeWindow: values.preferredTimeWindow,
        notes: values.notes,
        updatedAt: new Date(),
      })
      .where(eq(waitlistEntries.id, existing.id))
      .returning();

    return { row, rejoined: true as const };
  }

  const [row] = await db.insert(waitlistEntries).values(values).returning();
  return { row, rejoined: false as const };
}

/**
 * Everyone still in the queue, with the names their preferences refer to.
 *
 * Left joins because both preferences are optional and a null there means
 * "anyone" / "anything" rather than a missing row.
 */
export async function listWaitlistEntries(
  db: Database,
  businessId: string,
  statuses: readonly WaitlistStatus[] = LIVE_WAITLIST_STATUSES,
) {
  return db
    .select({
      entry: waitlistEntries,
      serviceName: services.name,
      staffName: staff.name,
    })
    .from(waitlistEntries)
    .leftJoin(services, eq(waitlistEntries.serviceId, services.id))
    .leftJoin(staff, eq(waitlistEntries.preferredStaffId, staff.id))
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        inArray(waitlistEntries.status, [...statuses]),
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt));
}

/** How many are waiting, for a badge that should not pay for the whole list. */
export async function countLiveWaitlistEntries(
  db: Database,
  businessId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        inArray(waitlistEntries.status, [...LIVE_WAITLIST_STATUSES]),
      ),
    );

  return row?.count ?? 0;
}

/** One entry, tenant-scoped so another shop's id does not resolve. */
export async function getWaitlistEntry(
  db: Database,
  businessId: string,
  entryId: string,
) {
  const [row] = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        eq(waitlistEntries.id, entryId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * The invite behind a token, with everything the page needs to describe the
 * slot being offered.
 *
 * Not tenant-scoped, and cannot be: the client following the link has no
 * session. The token *is* the credential, exactly as `cancel_token` is on
 * `/b/[token]`.
 */
export async function getWaitlistEntryByToken(db: Database, token: string) {
  const [row] = await db
    .select({
      entry: waitlistEntries,
      service: services,
      staffName: staff.name,
    })
    .from(waitlistEntries)
    .leftJoin(services, eq(waitlistEntries.invitedServiceId, services.id))
    .leftJoin(staff, eq(waitlistEntries.invitedStaffId, staff.id))
    .where(eq(waitlistEntries.inviteToken, token))
    .limit(1);

  return row ?? null;
}

/** Records the offer: which slot, and the token that accepts it. */
export async function markWaitlistInvited(
  db: Database,
  entryId: string,
  invite: {
    inviteToken: string;
    invitedStartsAt: Date;
    invitedEndsAt: Date;
    invitedStaffId: string;
    invitedServiceId: string;
  },
) {
  const [row] = await db
    .update(waitlistEntries)
    .set({
      ...invite,
      status: "notified",
      invitedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(waitlistEntries.id, entryId))
    .returning();

  return row ?? null;
}

/**
 * Takes an entry out of the queue.
 *
 * The token is cleared at the same time, which is what stops a link that has
 * already been used — or an offer the owner withdrew — from resolving at all.
 */
export async function setWaitlistStatus(
  db: Database,
  entryId: string,
  status: WaitlistStatus,
  { clearInvite = false }: { clearInvite?: boolean } = {},
) {
  const [row] = await db
    .update(waitlistEntries)
    .set({
      status,
      updatedAt: new Date(),
      ...(clearInvite ? { inviteToken: null } : {}),
    })
    .where(eq(waitlistEntries.id, entryId))
    .returning();

  return row ?? null;
}

/** Tenant-scoped, for the owner removing somebody by hand. */
export async function setWaitlistStatusForBusiness(
  db: Database,
  businessId: string,
  entryId: string,
  status: WaitlistStatus,
) {
  const [row] = await db
    .update(waitlistEntries)
    .set({ status, updatedAt: new Date(), inviteToken: null })
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        eq(waitlistEntries.id, entryId),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Slots that have come free and are still worth filling.
 *
 * **Derived from cancelled appointments rather than stored.** A cancelled row
 * already carries everything a freed slot is — when, how long, whose, for what —
 * so a second table recording "a slot opened" would be a copy that can disagree
 * with it, and would need its own cleanup when the appointment was restored.
 *
 * Three conditions, each doing real work: still in the future, because nobody
 * can take a slot that has passed; cancelled *recently*, so a booking dropped
 * months ago for a distant date is not announced as news; and cancelled at a
 * known time, which excludes rows from before `cancelled_at` existed rather
 * than guessing at them.
 */
export async function listFreedSlots(
  db: Database,
  businessId: string,
  { since, now }: { since: Date; now: Date },
) {
  return db
    .select({
      appointment: appointments,
      serviceName: services.name,
      staffName: staff.name,
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(staff, eq(appointments.staffId, staff.id))
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.status, "cancelled"),
        gte(appointments.cancelledAt, since),
        gt(appointments.startsAt, now),
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

/**
 * Which slots have already been offered to somebody.
 *
 * Keyed by the instant, which is enough: the banner's question is "has this
 * shop already acted on this opening", and an owner who invited the queue does
 * not need telling about it again on the next page load. Derived rather than
 * stored for the same reason as the slots themselves.
 */
export async function listInvitedSlotStarts(
  db: Database,
  businessId: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ invitedStartsAt: waitlistEntries.invitedStartsAt })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.businessId, businessId),
        sql`${waitlistEntries.invitedStartsAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(waitlistEntries.invitedAt));

  return new Set(
    rows
      .map((row) => row.invitedStartsAt?.getTime())
      .filter((time): time is number => typeof time === "number"),
  );
}
