"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  getAppointment,
  listWaitlistEntries,
  markWaitlistInvited,
  setWaitlistStatusForBusiness,
  upsertWaitlistEntry,
} from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import { enqueueWaitlistInvite } from "@/lib/notifications/enqueue";
import { reportError } from "@/lib/observability";
import { matchesForSlot, type FreedSlot } from "@/lib/waitlist";
import { normalizePhone } from "@/lib/validation";

export type WaitlistActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * How many people one freed slot is offered to at once.
 *
 * ---------------------------------------------------------------------------
 * Not everybody who matches, and the reason is money rather than fairness. Each
 * invite is a WhatsApp message the platform pays for, and a popular shop can
 * have dozens of matching entries for a single Tuesday morning — so an
 * unbounded "tell everyone" turns one cancellation into a bill. Ten is enough
 * that a slot reliably fills and small enough that a cancellation costs pennies.
 *
 * `matchesForSlot` sorts by longest wait, so the cap takes the people who have
 * been waiting longest rather than an arbitrary ten.
 * ---------------------------------------------------------------------------
 */
const MAX_INVITES_PER_SLOT = 10;

export type InvitedClient = {
  name: string;
  phone: string;
  /** The link that accepts the offer. Handed back so the owner can send it. */
  url: string;
};

export type InviteResult =
  | {
      ok: true;
      invited: InvitedClient[];
      /** Matched but not invited this round, because of the cap. */
      remaining: number;
      /**
       * Whether any message actually reached a provider. False on a deploy with
       * no live channel — the links above are then the whole delivery.
       */
      queued: boolean;
    }
  | { ok: false; error: string };

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/**
 * Offers a freed slot to the people waiting for one like it.
 *
 * ---------------------------------------------------------------------------
 * The slot is identified by the **cancelled appointment** that used to hold it,
 * which is re-read through the session's business rather than trusted, and
 * re-checked: it must still be cancelled and still be in the future. An owner
 * with a stale tab could otherwise invite the queue to a slot that has since
 * been restored, and everyone who followed the link would find it occupied.
 *
 * Every invited entry gets **its own token**, which is what makes the race
 * work: the link identifies the person as well as the slot, so whoever books
 * first can be marked `booked` and everybody else can be told what happened
 * rather than shown a generic failure.
 *
 * The links come back to the caller on purpose. There is no approved Meta
 * template for this kind yet, so on the official WhatsApp path the send is
 * refused — see PROJECT_PLAN §5. The outbox row is still written, so the cost
 * counter and `/master` see it the moment a template exists, and until then the
 * owner has a link per client they can send by hand. A feature that reported
 * success into a void would be worse than one that says "here is the message,
 * send it".
 * ---------------------------------------------------------------------------
 */
export async function inviteWaitlistForSlotAction(
  appointmentId: string,
): Promise<InviteResult> {
  const parsed = z.uuid().safeParse(appointmentId);
  if (!parsed.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireWritable();

  const appointment = await getAppointment(db, business.id, parsed.data);
  if (!appointment) return { ok: false, error: "התור לא נמצא" };

  if (appointment.status !== "cancelled") {
    return { ok: false, error: "התור הזה אינו מבוטל — אין כאן מועד פנוי" };
  }

  if (appointment.startsAt.getTime() <= Date.now()) {
    return { ok: false, error: "המועד הזה כבר עבר" };
  }

  const slot: FreedSlot = {
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    staffId: appointment.staffId,
    serviceId: appointment.serviceId,
  };

  const rows = await listWaitlistEntries(db, business.id);
  const matched = matchesForSlot(
    rows.map((row) => row.entry),
    slot,
    business.timezone,
  );

  if (matched.length === 0) {
    return { ok: false, error: "אין ברשימת ההמתנה לקוחות שמתאימים למועד הזה" };
  }

  const chosen = matched.slice(0, MAX_INVITES_PER_SLOT);
  const invited: InvitedClient[] = [];
  let queued = false;

  for (const entry of chosen) {
    // A fresh token per offer, so a link from a previous slot stops resolving
    // the moment this one is sent — an old link must never book a new slot.
    const inviteToken = randomUUID();

    const updated = await markWaitlistInvited(db, entry.id, {
      inviteToken,
      invitedStartsAt: slot.startsAt,
      invitedEndsAt: slot.endsAt,
      invitedStaffId: slot.staffId,
      invitedServiceId: slot.serviceId,
    });

    if (!updated) continue;

    invited.push({
      name: updated.clientName,
      phone: updated.clientPhone,
      url: `${appBaseUrl()}/w/${inviteToken}`,
    });

    // Best effort, and never allowed to lose the invite: the token is already
    // written, so a provider problem costs the message and not the offer.
    try {
      const rowsQueued = await enqueueWaitlistInvite({
        db,
        business,
        entry: updated,
      });
      if (rowsQueued.length > 0) queued = true;
    } catch (error) {
      reportError("waitlist.invite.enqueue", error, {
        businessId: business.id,
        entryId: entry.id,
      });
    }
  }

  if (queued) {
    // Sent now rather than on the next sweep. An invite is the most
    // time-critical message the product has: the slot is being offered to
    // several people and the first to answer takes it.
    try {
      await dispatchDueNotifications(db, { limit: MAX_INVITES_PER_SLOT * 2 });
    } catch (error) {
      reportError("waitlist.invite.dispatch", error, {
        businessId: business.id,
      });
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/waitlist");

  return {
    ok: true,
    invited,
    remaining: matched.length - chosen.length,
    queued,
  };
}

const statusSchema = z.enum(["active", "booked", "expired", "cancelled"]);

/** Removing somebody, or putting them back. Tenant-scoped. */
export async function setWaitlistEntryStatusAction(
  entryId: string,
  status: string,
): Promise<WaitlistActionResult> {
  const parsedId = z.uuid().safeParse(entryId);
  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, error: "בקשה לא תקינה" };
  }

  const { business } = await requireWritable();

  const updated = await setWaitlistStatusForBusiness(
    db,
    business.id,
    parsedId.data,
    parsedStatus.data,
  );

  if (!updated) return { ok: false, error: "הרישום לא נמצא" };

  revalidatePath("/dashboard/waitlist");
  return { ok: true, message: "הרשימה עודכנה" };
}

const manualSchema = z.object({
  clientName: z.string().trim().min(2, "יש להזין שם").max(80),
  clientPhone: z.string().trim().min(1, "יש להזין טלפון"),
  serviceId: z.union([z.uuid(), z.literal("")]).optional(),
  preferredStaffId: z.union([z.uuid(), z.literal("")]).optional(),
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferredTimeWindow: z
    .enum(["morning", "afternoon", "evening", "any"])
    .default("any"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * The owner adding somebody who rang up.
 *
 * Shares `upsertWaitlistEntry` with the public form, so a client who phoned and
 * then joined online holds one place rather than two — and this is the path that
 * can set a preferred provider, which the public form deliberately does not ask
 * about.
 */
export async function addWaitlistEntryAction(
  input: unknown,
): Promise<WaitlistActionResult> {
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  try {
    const { rejoined } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: parsed.data.clientName,
      clientPhone: normalizePhone(parsed.data.clientPhone),
      serviceId: parsed.data.serviceId || null,
      preferredStaffId: parsed.data.preferredStaffId || null,
      preferredDays: parsed.data.preferredDays,
      preferredTimeWindow: parsed.data.preferredTimeWindow,
      notes: parsed.data.notes || null,
    });

    revalidatePath("/dashboard/waitlist");
    return {
      ok: true,
      message: rejoined ? "הפרטים עודכנו ברשימה" : "הלקוח נוסף לרשימת ההמתנה",
    };
  } catch (error) {
    reportError("waitlist.add", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בהוספה לרשימה" };
  }
}
