import { eq } from "drizzle-orm";

import { platformSettings } from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * The platform's own settings row, and the runtime half of the WhatsApp cost
 * guard.
 *
 * ---------------------------------------------------------------------------
 * Reads **fail safe**, and that is the whole design.
 *
 * If this table cannot be read — pooler down, connection exhausted, a migration
 * not yet applied — `whatsappSuppressedByConsole` answers `true`, meaning
 * "suppress". Every other fail-open decision in this codebase (the proxy's slug
 * guard, the rate limiter) errs toward *letting the request through*, because
 * the cost of being wrong there is a page that does not render. Here the cost of
 * being wrong is money leaving an account and messages going to real clients
 * from a deploy that believed it was muted, so the bias is inverted deliberately.
 * ---------------------------------------------------------------------------
 */
export async function getPlatformSettings(db: Database) {
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, true))
    .limit(1);

  return row ?? null;
}

/** True when the console toggle is suppressing WhatsApp. Fails safe. */
export async function whatsappSuppressedByConsole(
  db: Database,
): Promise<boolean> {
  try {
    const row = await getPlatformSettings(db);
    // A missing row means the migration has not run. Suppress rather than
    // guess: an un-migrated deploy has never been told it may send.
    return row ? row.whatsappDispatchDisabled : true;
  } catch {
    return true;
  }
}

/**
 * Flips the toggle. `updatedBy` is recorded for the same reason impersonation
 * is audited — this switch decides whether real clients hear anything.
 */
export async function setWhatsappDispatchDisabled(
  db: Database,
  disabled: boolean,
  updatedBy: string,
) {
  const [row] = await db
    .update(platformSettings)
    .set({
      whatsappDispatchDisabled: disabled,
      updatedBy,
      updatedAt: new Date(),
    })
    .where(eq(platformSettings.id, true))
    .returning();

  return row ?? null;
}
