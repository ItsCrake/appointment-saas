"use server";

import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import { listServices } from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import { reportError } from "@/lib/observability";
import {
  isLibiConfigured,
  parseUtterance,
  type LibiService,
} from "@/lib/voice/libi";
import {
  fallbackPrompt,
  mergeDraft,
  missingFieldsFor,
  type LibiDraft,
  type RequiredField,
} from "@/lib/voice/libi-schema";

/** Hebrew weekday names, for the model's "today is …" context. */
const WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

/**
 * A transcript is arbitrary text from a microphone, so it is bounded like any
 * other untrusted string. 600 characters is far longer than anyone says in one
 * breath and far shorter than anything worth paying to tokenise.
 */
const voiceSchema = z.object({
  transcript: z.string().trim().min(1, "לא נקלט דיבור").max(600),
  draft: z.object({
    clientName: z.string().nullable(),
    clientPhone: z.string().nullable(),
    serviceId: z.string().nullable(),
    startLocal: z.string().nullable(),
    notes: z.string().nullable(),
  }),
});

export type VoiceParseResult =
  | {
      ok: true;
      /** Everything Libi has gathered so far, merged across the conversation. */
      draft: LibiDraft;
      /** Still-missing required fields, recomputed server-side. */
      missing: RequiredField[];
      /** What Libi says. Hebrew, always present. */
      message: string;
      /** True when nothing is missing — the client may now book. */
      complete: boolean;
    }
  | { ok: false; error: string };

/**
 * Turns one Hebrew utterance into a partial booking draft.
 *
 * **This action never writes anything.** It resolves the tenant from the
 * session, reads their catalogue, and returns a draft; creating the appointment
 * is `createManualBookingAction`, unchanged and re-validated on its own terms.
 * Keeping the two apart means voice adds no second path into the appointments
 * table — the exclusion constraint, the staff resolution and the notification
 * enqueue all stay in exactly one place.
 *
 * It still calls `requireWritable()` rather than `requireBusiness()`. It writes
 * nothing, but it spends money on the tenant's behalf and exists only to
 * produce a write, so a frozen tenant should not reach it.
 */
export async function parseVoiceAppointment(
  input: unknown,
): Promise<VoiceParseResult> {
  const parsed = voiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  /**
   * The entitlement is checked in the action, not only where the button is
   * rendered. A Server Action is a plain POST endpoint — a hidden microphone
   * proves nothing about who can call this, and this one costs money per call.
   * Same reasoning as the analytics gate and every `/master` action.
   */
  if (!entitlementsFor(business).canAccessLibi) {
    return { ok: false, error: "העוזרת הקולית זמינה במסלול המקצועי." };
  }

  if (!isLibiConfigured()) {
    return { ok: false, error: "העוזרת הקולית אינה מוגדרת במערכת." };
  }

  const services = await listServices(db, business.id);
  if (services.length === 0) {
    return { ok: false, error: "אין שירותים מוגדרים בעסק." };
  }

  const catalogue: LibiService[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    durationMin: s.durationMin,
  }));

  const now = new Date();
  const nowLocal = formatInTimeZone(
    now,
    business.timezone,
    "yyyy-MM-dd'T'HH:mm",
  );
  const todayWeekday =
    WEEKDAYS[Number(formatInTimeZone(now, business.timezone, "i")) % 7];

  const result = await parseUtterance({
    transcript: parsed.data.transcript,
    services: catalogue,
    nowLocal,
    todayWeekday,
    timezone: business.timezone,
    draft: parsed.data.draft,
  });

  if (!result.ok) {
    reportError("dashboard.voice.parse", new Error(result.error), {
      businessId: business.id,
    });
    return { ok: false, error: result.error };
  }

  const { extraction } = result;

  /**
   * The returned `serviceId` is matched against the tenant's own catalogue
   * before it is kept.
   *
   * The prompt says to return only an id from the list, and that is guidance,
   * not a guarantee — a hallucinated uuid would otherwise travel to
   * `createManualBookingAction`, which resolves the service through the
   * business and would refuse it there. This turns that late refusal into a
   * question Libi can ask now, and closes the case where the id belongs to a
   * *different tenant's* service.
   */
  const serviceId =
    extraction.serviceId && catalogue.some((s) => s.id === extraction.serviceId)
      ? extraction.serviceId
      : null;

  const draft = mergeDraft(parsed.data.draft, {
    clientName: extraction.clientName,
    clientPhone: extraction.clientPhone,
    serviceId,
    startLocal: extraction.startLocal,
    notes: extraction.notes,
  });

  const missing = missingFieldsFor(draft);

  /**
   * Libi's own sentence is preferred — it can refer to what she already has
   * ("ומה הטלפון של דני?") in a way a generated one cannot. It is replaced only
   * when it would be actively misleading: an empty message, or a claim of
   * completeness the server-side recomputation disagrees with.
   */
  const modelSaysDone = extraction.missingFields.length === 0;
  const trustMessage =
    extraction.feedbackMessage.trim() !== "" &&
    modelSaysDone === (missing.length === 0);

  return {
    ok: true,
    draft,
    missing,
    message: trustMessage
      ? extraction.feedbackMessage.trim()
      : fallbackPrompt(missing),
    complete: missing.length === 0,
  };
}
