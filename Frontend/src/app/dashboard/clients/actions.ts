"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  getClientProfile,
  getClientStats,
  listClientHistory,
  upsertClientProfile,
  type ClientStats,
} from "@/db/queries";
import { requireBusiness, requireWritable } from "@/lib/dashboard-session";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { reportError } from "@/lib/observability";

export type ClientProfileResult =
  { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  /**
   * The identity, not a display value. Validated to the same shape a booking
   * stores so a crafted request cannot create a profile against a phone number
   * that could never appear in this tenant's history.
   */
  clientPhone: z.string().trim().min(1).max(30),
  /**
   * Generous, because this is where an owner writes what they know about
   * somebody and a cap that clips mid-sentence is worse than a long row.
   */
  notes: z.string().trim().max(2000, "ההערות ארוכות מדי"),
});

/**
 * Saves the preferences an owner keeps about one client.
 *
 * `requireWritable`, so a frozen tenant reads their notes and cannot add to
 * them — the same gate every other dashboard write goes through. The business
 * comes from the session and never from the payload, which is what stops a
 * request writing a note into somebody else's client list.
 */
export async function saveClientProfileAction(
  input: unknown,
): Promise<ClientProfileResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  try {
    await upsertClientProfile(
      db,
      business.id,
      parsed.data.clientPhone,
      parsed.data.notes,
    );
  } catch (error) {
    reportError("clients.saveProfile", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בשמירת ההערות" };
  }

  revalidatePath("/dashboard/clients");
  // The calendar's hover card reads these too.
  revalidatePath("/dashboard/agenda/full");

  return { ok: true, message: "ההערות נשמרו" };
}

/**
 * Everything about one client, fetched when their row is opened.
 *
 * On demand rather than with the list. A shop with four hundred clients would
 * otherwise pay for four hundred histories and four hundred stat scans to
 * render a table that shows a name and a count — for the one row an owner is
 * about to click.
 *
 * `requireBusiness`, not `requireWritable`: reading a client's history is not a
 * write, and a frozen tenant keeps their records.
 */
export async function loadClientProfileAction(clientPhone: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      profile: {
        clientPhone: string;
        clientName: string;
        notes: string;
        stats: ClientStats;
        history: {
          id: string;
          when: string;
          status: string;
          serviceName: string;
          price: string;
          notes: string | null;
        }[];
      };
    }
> {
  const parsed = z.string().trim().min(1).max(30).safeParse(clientPhone);
  if (!parsed.success) return { ok: false, error: "מספר טלפון לא תקין" };

  const { business } = await requireBusiness();
  const phone = parsed.data;

  const [profile, stats, history] = await Promise.all([
    getClientProfile(db, business.id, phone),
    getClientStats(db, business.id, phone),
    listClientHistory(db, business.id, phone),
  ]);

  if (stats.total === 0 && !profile) {
    // No history and no note means this phone belongs to no client of theirs —
    // which is what a crafted request looks like.
    return { ok: false, error: "הלקוח לא נמצא" };
  }

  return {
    ok: true,
    profile: {
      clientPhone: phone,
      // The most recent name they used, matching the list. People re-book with
      // slight spelling changes and the latest is the one they answer to.
      clientName: history[0]?.clientName ?? phone,
      notes: profile?.notes ?? "",
      stats,
      history: history.map((row) => {
        // Formatted here, in the business timezone: doing it in the drawer
        // would render one string on the server and another after hydration
        // for anyone whose device sits in a different zone.
        const when = formatFullDateTime(
          row.startsAt.toISOString(),
          business.timezone,
        );
        return {
          id: row.id,
          when: `${when.date} · ${when.time}`,
          status: row.status,
          serviceName: row.serviceName,
          price: formatPrice(row.priceCents),
          notes: row.notes,
        };
      }),
    },
  };
}
