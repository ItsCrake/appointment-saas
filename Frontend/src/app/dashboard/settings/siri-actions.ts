"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { setSiriToken } from "@/db/queries/siri";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { generateSiriToken } from "@/lib/siri/token";

export type SiriActionResult =
  | { ok: true; token: string | null; message: string }
  | { ok: false; error: string };

/**
 * Mints a Siri token, replacing any existing one.
 *
 * ---------------------------------------------------------------------------
 * **Generate and regenerate are one action, because they are one operation.**
 * The column holds a single value; writing a new one is what revokes the old,
 * and a separate "regenerate" would be the same UPDATE behind a second name.
 * The UI says which of the two is happening — it knows whether a token already
 * existed — and the confirmation an owner needs before breaking a working
 * Shortcut belongs there, next to the button, rather than here.
 *
 * `requireWritable` rather than `requireBusiness`: this writes, and a frozen
 * tenant must not be able to. Note the asymmetry with the endpoint itself,
 * which *does* answer a frozen shop — reading your own calendar is not the
 * thing non-payment suspends, but minting a new credential is a change.
 * ---------------------------------------------------------------------------
 */
export async function generateSiriTokenAction(): Promise<SiriActionResult> {
  const { business } = await requireWritable();

  try {
    const token = generateSiriToken();
    const saved = await setSiriToken(db, business.id, token);

    if (!saved?.token) {
      return { ok: false, error: "לא הצלחנו ליצור מפתח. נסו שוב." };
    }

    revalidatePath("/dashboard/settings");
    return {
      ok: true,
      token: saved.token,
      message: "נוצר מפתח חדש ל-Siri",
    };
  } catch (error) {
    // `reportError` redacts any key matching /token/i; nothing here passes one
    // in regardless.
    reportError("siri.generateToken", error, { businessId: business.id });
    return { ok: false, error: "לא הצלחנו ליצור מפתח. נסו שוב." };
  }
}

/**
 * Revokes the token by clearing the column.
 *
 * A full revoke, because the column is the only copy — there is no session to
 * expire, no cache to bust and no second store holding a duplicate. Any
 * Shortcut still holding it starts getting the "המפתח לא תקף יותר" sentence on
 * the next question, which is the message an owner needs to hear on the device
 * that is still asking.
 */
export async function revokeSiriTokenAction(): Promise<SiriActionResult> {
  const { business } = await requireWritable();

  try {
    await setSiriToken(db, business.id, null);
    revalidatePath("/dashboard/settings");
    return { ok: true, token: null, message: "החיבור ל-Siri נותק" };
  } catch (error) {
    reportError("siri.revokeToken", error, { businessId: business.id });
    return { ok: false, error: "לא הצלחנו לנתק את החיבור. נסו שוב." };
  }
}
