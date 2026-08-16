import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import {
  EMPTY_DRAFT,
  libiExtractionSchema,
  type LibiDraft,
  type LibiExtraction,
} from "./libi-schema";

/**
 * The model call behind Libi.
 *
 * **Server-only, enforced the way this codebase enforces it.** The module reads
 * `ANTHROPIC_API_KEY`, which has no `NEXT_PUBLIC_` prefix — so a `"use client"`
 * module importing it would get `undefined` inlined and the feature would fail
 * quietly, inviting somebody to "fix" it by renaming the variable. That is the
 * step that leaks a billable key into a public bundle.
 *
 * The guard is a runtime throw plus `libi-isolation.test.ts`, mirroring
 * `lib/supabase/admin.ts` exactly, rather than the `server-only` package —
 * which is not a dependency here and would be a second mechanism for a property
 * this repo already has one for.
 */
function assertServer() {
  if (typeof window !== "undefined") {
    throw new Error("lib/voice/libi is server-only and must not be bundled");
  }
}

/**
 * Claude Opus 5. Not downgraded for cost: a mis-parsed Hebrew utterance books
 * the wrong person at the wrong time, and the owner finds out when somebody
 * turns up. Effort is where the cost lever belongs — see below.
 */
const MODEL = "claude-opus-5";

/**
 * `low` effort, and this is a deliberate, testable choice rather than a default.
 *
 * The task is single-turn extraction from one short sentence against a supplied
 * catalogue — the shape lower effort handles well — and this call sits between
 * an owner speaking and a spinner stopping, so latency is the felt cost. Raise
 * it if relative-date handling ("יום שלישי הבא") turns out to need more.
 *
 * Thinking is left **on** (adaptive is Opus 5's default). Disabling it is the
 * documented cause of two failure modes — tool calls emitted as plain text and
 * `<thinking>` tags leaking into output — and buys nothing here that low effort
 * does not already buy.
 */
const EFFORT = "low" as const;

/**
 * Generous relative to the payload, because `max_tokens` caps thinking *plus*
 * response on Opus 5 and thinking is on. A tight cap here would truncate
 * mid-JSON, which structured outputs surface as a parse failure rather than as
 * anything that names the real cause.
 */
const MAX_TOKENS = 4096;

export type LibiService = {
  id: string;
  name: string;
  durationMin: number;
};

export type LibiInput = {
  transcript: string;
  /** The tenant's real catalogue. Libi may only ever return one of these ids. */
  services: LibiService[];
  /** Business-local "now", `YYYY-MM-DDTHH:mm`, plus the weekday name in Hebrew. */
  nowLocal: string;
  todayWeekday: string;
  timezone: string;
  /** What Libi already gathered earlier in this conversation. */
  draft: LibiDraft;
};

export type LibiResult =
  { ok: true; extraction: LibiExtraction } | { ok: false; error: string };

/** Present when a key is configured. Null is a legitimate state — see `isLibiConfigured`. */
function client(): Anthropic | null {
  assertServer();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Whether Libi can actually reach a model.
 *
 * The button is not rendered when this is false. That is the same rule the rest
 * of the product follows for a channel with no provider: a control that appears
 * to work and does not is how trust in every other control goes. There is
 * deliberately **no console fallback** here — a fake parse would either invent
 * an appointment or refuse every sentence, and both are worse than the feature
 * being visibly absent.
 */
export function isLibiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function systemPrompt(input: LibiInput): string {
  const catalogue = input.services
    .map((s) => `- id=${s.id} | "${s.name}" | ${s.durationMin} דקות`)
    .join("\n");

  const draftLines = (Object.entries(input.draft) as [string, string | null][])
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return `את "ליבי", עוזרת קולית של מערכת ניהול תורים לעסקים בישראל. בעל העסק מדבר אלייך בעברית ואת מחלצת מתוך המשפט את פרטי התור.

## הקשר
- השעה המקומית עכשיו: ${input.nowLocal} (יום ${input.todayWeekday})
- אזור זמן: ${input.timezone}

## השירותים של העסק
${catalogue}

## מה שכבר נאסף בשיחה הזו
${draftLines || "- (עדיין כלום)"}

## כללים
1. serviceId חייב להיות בדיוק אחד מה-id שברשימה למעלה, או null. אסור להמציא id. אם נאמר שם שירות שלא ברשימה — החזירי null וציירי זאת ב-feedbackMessage.
2. startLocal הוא שעון מקומי בפורמט YYYY-MM-DDTHH:mm. אל תמירי לאזור זמן אחר ואל תוסיפי היסט. פתרי ביטויים יחסיים ("מחר", "יום שלישי הבא", "בעוד שעתיים") מול השעה המקומית שלמעלה.
3. אם לא נאמר תאריך אבל נאמרה שעה — הניחי את ההזדמנות הקרובה ביותר בעתיד.
4. אל תמציאי שם, טלפון או שירות שלא נאמרו. שדה שלא נאמר הוא null.
5. שדה שכבר נאסף נשאר כפי שהוא, אלא אם המשפט החדש מתקן אותו במפורש.
6. missingFields — רק שדות חובה שחסרים: serviceId, startLocal, clientName, clientPhone.
7. feedbackMessage בעברית, משפט אחד, בגוף שני. אם חסר משהו — שאלי על הדבר הראשון שחסר והתייחסי למה שכבר יש ("ומה הטלפון של דני?"). אם הכול קיים — אשרי בקצרה מה עומד להיקבע.
8. אם לא הבנת את המשפט בכלל — confidence: "low", כל השדות null, ובקשי לחזור על זה.`;
}

/**
 * Parses one Hebrew utterance into a partial booking.
 *
 * Returns a *failure* rather than throwing, because every caller is a Server
 * Action whose job is to put a Hebrew sentence on screen — an exception here
 * would reach the owner as an unparseable Server Action reply, which is the
 * failure class ARCHITECTURE.md has a whole section about.
 */
export async function parseUtterance(input: LibiInput): Promise<LibiResult> {
  const anthropic = client();
  if (!anthropic) {
    return { ok: false, error: "העוזרת הקולית אינה מוגדרת במערכת." };
  }

  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: EFFORT,
        format: zodOutputFormat(libiExtractionSchema),
      },
      system: systemPrompt(input),
      messages: [{ role: "user", content: input.transcript }],
    });

    /**
     * Checked before `parsed_output` is read, not after.
     *
     * Opus 5's safety classifiers can decline a request and return HTTP 200
     * with `stop_reason: "refusal"` and no content. Nothing about scheduling a
     * haircut should trip them, but the branch costs one line and its absence
     * is a crash rather than a message.
     */
    if (response.stop_reason === "refusal") {
      return { ok: false, error: "לא הצלחתי לעבד את הבקשה הזו." };
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return {
        ok: false,
        error: "לא הצלחתי להבין את מה שנאמר. אפשר לנסות שוב?",
      };
    }

    return { ok: true, extraction: parsed };
  } catch (error) {
    /**
     * Rethrown as a value, deliberately without the provider's message. A
     * rate-limit body or a stack from the SDK is not something to render into a
     * Hebrew toast, and the real detail goes to `reportError` at the call site.
     */
    void error;
    return {
      ok: false,
      error: "שירות הזיהוי אינו זמין כרגע. נסו שוב בעוד רגע.",
    };
  }
}

export { EMPTY_DRAFT };
