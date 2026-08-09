"use server";

import { db } from "@/db";
import {
  getActiveBusinessBySlug,
  listAppointmentsForClient,
} from "@/db/queries";
import { getCancellationState } from "@/lib/cancellation";
import { formatFullDateTime } from "@/lib/format";
import { reportError } from "@/lib/observability";
import { LOOKUP_RULES, rateLimitMessage } from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { getClientIp } from "@/lib/request-context";
import { isValidPhone, normalizePhone } from "@/lib/validation";

/**
 * One row as the page renders it. Everything is pre-formatted in the business
 * timezone, because the browser's zone is not the shop's and a client abroad
 * must not be shown the wrong day for their own appointment.
 */
export type MyAppointment = {
  id: string;
  /**
   * The same opaque token the confirmation link carries. Handing it over after
   * a successful lookup is what lets cancellation reuse `cancelBookingAction`
   * unchanged — one code path, one set of rules, no second implementation of
   * "may this still be cancelled".
   */
  cancelToken: string;
  status: string;
  serviceName: string;
  staffName: string | null;
  priceCents: number;
  startsAt: string;
  /** "יום ג׳, 12.8.2026" and "09:00", ready to render. */
  weekday: string;
  date: string;
  time: string;
  isPast: boolean;
  /** Whether the client may cancel it themselves, by the business's own rule. */
  canCancel: boolean;
};

export type LookupResult =
  | {
      ok: true;
      upcoming: MyAppointment[];
      past: MyAppointment[];
      /** Repeated back so the page can say whose list it is showing. */
      phone: string;
      cancelWindowHours: number;
    }
  | { ok: false; error: string };

/**
 * A client's own appointments at one business, by phone number.
 *
 * The phone travels in a Server Action body, never in the URL: a query string
 * ends up in browser history, in referrer headers and in server logs, and this
 * one identifies a person.
 *
 * **The phone is the only thing proving who is asking**, which is why
 * `LOOKUP_RULES` is the tightest non-auth limit in the app. See the note there.
 */
export async function lookupMyAppointmentsAction(
  slug: string,
  rawPhone: string,
): Promise<LookupResult> {
  if (typeof slug !== "string" || typeof rawPhone !== "string") {
    return { ok: false, error: "בקשה לא תקינה" };
  }

  if (!isValidPhone(rawPhone)) {
    return {
      ok: false,
      error: "מספר טלפון נייד לא תקין (לדוגמה: 050-1234567)",
    };
  }

  const phone = normalizePhone(rawPhone);

  const limited = await enforceRateLimits(db, [
    { rule: LOOKUP_RULES.ip, identifier: await getClientIp() },
    { rule: LOOKUP_RULES.phone, identifier: phone },
  ]);
  if (!limited.allowed) {
    return { ok: false, error: rateLimitMessage(limited.decision) };
  }

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) return { ok: false, error: "העסק לא נמצא" };

  try {
    const rows = await listAppointmentsForClient(db, business.id, phone);
    const now = new Date();

    const all = rows.map(({ appointment, staffName }) => {
      const state = getCancellationState(
        appointment,
        business.cancelWindowHours,
        now,
      );

      return {
        id: appointment.id,
        cancelToken: appointment.cancelToken,
        status: appointment.status,
        serviceName: appointment.serviceName,
        staffName,
        priceCents: appointment.priceCents,
        startsAt: appointment.startsAt.toISOString(),
        // The shared helper, because it is the one place the Hebrew weekday
        // names live — `date-fns` would give English ones here.
        ...formatFullDateTime(
          appointment.startsAt.toISOString(),
          business.timezone,
        ),
        isPast: state.isPast,
        canCancel: state.canCancel,
      } satisfies MyAppointment;
    });

    return {
      ok: true,
      phone,
      cancelWindowHours: business.cancelWindowHours,
      // Soonest first for what is ahead; most recent first for what is behind.
      // Both are "nearest to now", which is what someone is looking for.
      upcoming: all.filter((row) => !row.isPast).reverse(),
      past: all.filter((row) => row.isPast),
    };
  } catch (error) {
    reportError("myAppointments.lookup", error, { slug });
    return { ok: false, error: "אירעה שגיאה בטעינת התורים. נסו שוב." };
  }
}
