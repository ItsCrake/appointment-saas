"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { updateBusiness } from "@/db/queries";
import {
  deletePushSubscription,
  savePushSubscription,
} from "@/db/queries/push";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { isPushConfigured, sendPushToBusiness } from "@/lib/push";

export type PushResult =
  { ok: true; message?: string } | { ok: false; error: string };

/**
 * The shape the browser's `PushSubscription.toJSON()` produces.
 *
 * Validated rather than trusted: this arrives from the client, and both keys
 * end up in a payload we later encrypt with them. `.max()` on each because they
 * are fixed-length base64 in practice, and an unbounded text column fed from a
 * request is a row somebody can make arbitrarily large.
 */
const subscriptionSchema = z.object({
  endpoint: z.url("כתובת לא תקינה").max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(400).optional(),
});

/**
 * Registers this device and switches notifications on.
 *
 * Both together on purpose: an owner who has just granted browser permission
 * has unambiguously asked for notifications, and leaving the tenant flag off
 * would mean the prompt they accepted did nothing.
 */
export async function subscribeToPushAction(
  input: unknown,
): Promise<PushResult> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "פרטי המנוי להתראות אינם תקינים" };
  }

  const { business } = await requireWritable();

  if (!isPushConfigured()) {
    return {
      ok: false,
      error: "התראות פוש לא מוגדרות בשרת. פנו אלינו ונפעיל.",
    };
  }

  try {
    await savePushSubscription(db, {
      businessId: business.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent ?? null,
    });
    await updateBusiness(db, business.id, { pushEnabled: true });
  } catch (error) {
    reportError("push.subscribe", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בהפעלת ההתראות" };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "התראות הופעלו במכשיר הזה" };
}

/**
 * Removes this device.
 *
 * The tenant flag stays on if any other device is still registered — an owner
 * turning notifications off on their laptop has not asked their phone to go
 * quiet. The flag is only cleared by the explicit toggle below.
 */
export async function unsubscribeFromPushAction(
  endpoint: unknown,
): Promise<PushResult> {
  const parsed = z.url().max(2000).safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireWritable();

  // Scoped by tenant inside the query: an endpoint arrives from the browser,
  // and deleting by a client-supplied key alone is one crafted request away
  // from unsubscribing somebody else's phone.
  await deletePushSubscription(db, business.id, parsed.data);

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "ההתראות כובו במכשיר הזה" };
}

/**
 * The tenant-level switch.
 *
 * Separate from the device rows because turning notifications off and on again
 * must not require asking the browser for permission a second time — that is a
 * prompt a person can only refuse once, and a refused prompt cannot be
 * re-asked without the owner digging through site settings.
 */
export async function setPushEnabledAction(
  enabled: boolean,
): Promise<PushResult> {
  const { business } = await requireWritable();

  await updateBusiness(db, business.id, { pushEnabled: Boolean(enabled) });

  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: enabled ? "התראות הופעלו" : "התראות כובו",
  };
}

/** Proves the whole chain works, from this server to that phone. */
export async function sendTestPushAction(): Promise<PushResult> {
  const { business } = await requireWritable();

  const result = await sendPushToBusiness(db, business.id, {
    title: "בזמן",
    body: "ההתראות עובדות. כאן יופיעו תורים חדשים.",
    tag: "test",
  });

  if (result.sent === 0) {
    return {
      ok: false,
      error:
        result.failed > 0
          ? "לא הצלחנו לשלוח התראה למכשירים הרשומים."
          : "אין מכשירים רשומים. הפעילו התראות במכשיר הזה קודם.",
    };
  }

  return {
    ok: true,
    message: `נשלחה התראה ל-${result.sent} מכשירים`,
  };
}
