import { reportWarning } from "@/lib/observability";

import {
  assertVoiceServer,
  elevenLabsConfig,
  INTENT_MODEL,
  STT_MODEL,
  TTS_MODEL,
  ttsVoice,
  voiceApiKey,
} from "./libi-config";
import {
  READ_ONLY_TOOLS,
  VOICE_TOOLS,
  executePending,
  runVoiceTool,
  upcomingRoster,
  type PendingAction,
  type ToolContext,
  type ToolOutcome,
} from "./libi-tools";
import { classifyConfirmation } from "./libi-confirm";
import { historyMessages, type Turn } from "./libi-history";
import { buildPromptContext } from "./libi-context";

/**
 * The three steps: hear, decide, speak.
 *
 * ---------------------------------------------------------------------------
 * **Plain `fetch`, no SDK.** These are three HTTP calls, and the one with any
 * subtlety — Whisper's multipart upload — is handled by the runtime's own
 * `FormData` rather than by hand. That matters: the last hand-rolled multipart
 * body in this repository copied the fields and forgot the headers, and every
 * upload since has been stored uncacheable. Letting `fetch` encode it is how
 * that does not happen twice. The cost of the dependency is also real — the
 * dashboard ships 19KB of JavaScript and none of this belongs in it.
 *
 * **Every step has a timeout.** The owner is standing still with a phone up.
 * A model call that hangs for the platform's default is worse than one that
 * fails at ten seconds and says so, because the second one lets them try again
 * inside the same haircut.
 *
 * **The transcript is returned even when the rest fails.** Seeing what was
 * heard is most of the debugging an owner can do — "it thought I said Dana"
 * is actionable, "it did not work" is not.
 * ---------------------------------------------------------------------------
 */
const OPENAI = "https://api.openai.com/v1";

/** Long enough for a slow model, short enough that a person will wait. */
const STEP_TIMEOUT_MS = 15_000;

async function openai(
  path: string,
  init: RequestInit,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<Response> {
  assertVoiceServer();
  const abort = AbortSignal.timeout(timeoutMs);

  const response = await fetch(`${OPENAI}${path}`, {
    ...init,
    signal: abort,
    headers: { Authorization: `Bearer ${voiceApiKey()}`, ...init.headers },
  });

  if (!response.ok) {
    // The body carries OpenAI's own message, which is what distinguishes "no
    // credit" from "bad audio". It never contains the key.
    const detail = await response.text().catch(() => "");
    throw new Error(`${path} failed: ${response.status} ${detail.slice(0, 200)}`);
  }

  return response;
}

/** Step 1 — speech to Hebrew text. */
export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", STT_MODEL);
  /**
   * Hebrew, stated rather than detected.
   *
   * Whisper guesses a language from the first seconds, and a short Hebrew
   * utterance with an English loanword in it — "יש לי תור ב-Zoom" — is
   * routinely guessed as English and transcribed as nonsense. The shop's
   * language is known, so it is not a guess worth making.
   */
  form.append("language", "he");
  form.append("response_format", "json");

  const response = await openai("/audio/transcriptions", {
    method: "POST",
    body: form,
  });

  const { text } = (await response.json()) as { text?: string };
  return (text ?? "").trim();
}

/**
 * The instructions half of the prompt. The data half is built per request by
 * `buildPromptContext` and prepended to this.
 *
 * ---------------------------------------------------------------------------
 * **Written to be acted on, not read.** Every line here is either a rule that
 * changes an answer or a format the tools require. The prose that used to
 * explain *why* a tool is authoritative is gone — the model does not need the
 * argument, only the instruction, and each sentence it does not need is
 * latency on a turn somebody is standing still for.
 *
 * **The tools stay authoritative and the prompt still says so.** With the
 * roster in front of it a model will happily answer "מה התור הבא שלי?" from
 * the list, and its sentence would be plausible, ungrounded prose where the
 * tool's is exact, tested Hebrew with the shop's own counting and time
 * formatting. So the ordering is stated first and stated shortly.
 *
 * **Which tool to reach for lives in the tool descriptions, not here.**
 * Function-calling matches on those, so trigger verbs belong there; repeating
 * them in the system prompt paid for the same tokens twice and gave the model
 * two places to disagree with itself.
 *
 * **The opening-hours rule is there because the model invented a refusal.**
 * Asked to book at ten at night it answered "אין תורים זמינים" — a sentence
 * from no tool and no string in this repository — and called nothing. The
 * model was reasoning about the *client-facing* availability engine, which
 * this path deliberately does not consult: an owner squeezing somebody in
 * after closing is exercising authority the software has no business
 * refusing. So the prompt now says the hours do not bind her, and says which
 * refusal *is* hers to make: a clash, decided by the tool.
 *
 * **Reference resolution is the model's job, and the tool still checks it.**
 * "תזיז אותו" is resolved from the previous assistant message into a client
 * *name*, which the tool then looks up itself — so the pronoun never becomes
 * an appointment id travelling through a prompt, and the ambiguity guard that
 * refuses two clients called דניאל still runs on whatever the model decided.
 *
 * **No preamble.** "בטח, אני בודקת עכשיו…" is a sentence the owner waits
 * three seconds for ElevenLabs to speak before hearing the answer, so it is
 * forbidden rather than discouraged.
 * ---------------------------------------------------------------------------
 */
const INSTRUCTIONS = `את "ליבי", העוזרת הקולית של בזמן. בעל העסק מדבר אלייך בעברית על היומן שלו.

כללים:
- יש כלי שמתאים? קראי לו מיד, בתור הראשון. אל תשאלי שאלות הבהרה שהכלי עצמו שואל.
- אין כלי מתאים? עני מהיומן שלמעלה בלבד. אל תמציאי דבר; מה שאינו שם — אמרי שאינך רואה אותו.
- לעולם אל תקריאי רשימה. את נשמעת בקול, לא נקראת: בלי מקפים, בלי נקודות, בלי "confirmed", בלי שורות. כמה תורים? אמרי כמה יש ומתי הראשון והאחרון, במשפט אחד. שואלים על תור מסוים? שם, שעה, שירות — וזהו.
- תאריכים תמיד YYYY-MM-DD, שעות תמיד HH:MM. תרגמי "היום", "מחר", "ביום חמישי" לתאריך לפי התאריך שלמעלה. לעולם אל תשלחי מילים בשדות האלה.
- שעה בעברית מדוברת היא שעת עסק: "בשלוש" = 15:00, "בשמונה בבוקר" = 08:00.
- שעות הפעילות אינן מגבילות אותך. בעל העסק רשאי לקבוע ולהזיז תורים בכל שעה — שש בבוקר, עשר בלילה, יום סגור. לעולם אל תסרבי בגלל שעה, אל תגידי "אין תורים זמינים" ואל תשאלי אם הוא בטוח. קראי לכלי. רק הכלי מחליט אם יש התנגשות.
- טלפון ב-create_appointment אינו חובה. לא הוכתב מספר — אל תבקשי, אל תשאלי, אל תמציאי, פשוט אל תשלחי את השדה.
- בלי הקדמות ובלי אישורי ביניים. לא "רגע", לא "אני בודקת" — תשובה אחת קצרה בעברית, מתאימה להקראה.
- יש שיחה קודמת למעלה? "אותו", "אותה", "זה", "התור הזה", "ואז" ו"גם" מתייחסים לתור שדיברתן עליו בתור הקודם. פתרי את ההתייחסות בעצמך והעבירי לכלי את שם הלקוח שנאמר שם — אל תשאלי "לאיזה תור התכוונת" אם זה ברור מהשיחה.
- המשך של בקשה קודמת הוא בקשה מלאה. "תזיזי אותו שעה קדימה" = הזזה לשעה שהיא שעה אחרי השעה שנאמרה למעלה; חשבי אותה בעצמך ושלחי HH:MM.
- לא הבנת? בקשי שיחזור. אל תנחשי.
- שואלים מי את: "היי, אני ליבי — העוזרת של בזמן."`;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};

/**
 * Step 2 — what the sentence means, and what to do about it.
 *
 * One round of tool calling, deliberately: the model picks a tool, the tool
 * answers, and the tool's own Hebrew sentence is what gets spoken. The model
 * does **not** get to rewrite it. That is what stops a summary drifting from
 * the data — the numbers and times in the reply come from `libi-speech`,
 * which is pure and tested, rather than from a model asked to be careful.
 */
export async function decide(
  transcript: string,
  ctx: ToolContext,
  pending?: PendingAction,
  {
    writable = true,
    history = [],
  }: { writable?: boolean; history?: readonly Turn[] } = {},
): Promise<ToolOutcome> {
  /**
   * **The answer to a pending question never reaches the model.**
   *
   * If something is awaiting confirmation, "כן" means one thing and it is
   * decided by a word list — see `libi-confirm`. Routing it through the model
   * instead would make the gate in front of every cancellation a generated
   * sentence, and a bare "כן" with no tools that fit is exactly the input a
   * model is most likely to be creative about.
   *
   * `"unclear"` deliberately falls through to a normal turn rather than
   * re-asking: the owner has moved on, and the pending action is dropped by
   * simply not being returned again.
   */
  if (pending) {
    const answer = classifyConfirmation(transcript);

    if (answer === "confirm") return executePending(pending, ctx);
    if (answer === "deny") {
      return { spoken: "בסדר, לא שיניתי כלום.", actionTaken: "declined" };
    }
  }

  /**
   * Fetched before the model call rather than offered as another tool.
   *
   * A tool would cost a second round trip through the model to answer half the
   * questions asked — the owner is waiting through this — and the clock is
   * needed whichever tool is chosen, since "today" and "Thursday" are
   * arguments the model cannot resolve without it.
   */
  const roster = await upcomingRoster(ctx);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${buildPromptContext(ctx.now, ctx.timezone, roster)}

${INSTRUCTIONS}`,
    },
    /**
     * The exchange so far, oldest first, between the instructions and what was
     * just said.
     *
     * As real turns rather than as a summary pasted into the system prompt:
     * "אותו" resolves against the *previous assistant message*, which is where
     * a chat model looks for it, and flattening the pair into prose is how that
     * stops working. Already bounded by `parseHistory` before it gets here.
     */
    ...historyMessages(history),
    { role: "user", content: transcript },
  ];

  const response = await openai("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: INTENT_MODEL,
      messages,
      /**
       * A frozen tenant is offered the reading tools only. Withholding them is
       * better than letting the model pick one and having the tool refuse: the
       * model then explains the situation in its own words instead of ליבי
       * announcing a booking that did not happen.
       */
      tools: writable ? VOICE_TOOLS : READ_ONLY_TOOLS,
      tool_choice: "auto",
      /**
       * One tool per turn, stated rather than hoped for.
       *
       * Only `tool_calls[0]` is ever run, so a model that emitted three would
       * be billed for two it could not act on — and, worse, would look like it
       * had done three things when the owner heard the first one's sentence.
       */
      parallel_tool_calls: false,
      // Zero, and it matters more now that the model can read the diary: this
      // is the difference between reading a row back and paraphrasing it.
      temperature: 0,
      /**
       * Enough for one spoken sentence or one tool call, and not enough for a
       * paragraph. A tool call is a few dozen tokens; the only free-text path
       * is "I did not understand", which is six words. 200 was headroom for a
       * model that is never asked to write at length.
       */
      max_tokens: 120,
    }),
  });

  const body = (await response.json()) as {
    choices?: { message?: ChatMessage }[];
  };
  const message = body.choices?.[0]?.message;
  const call = message?.tool_calls?.[0];

  if (!call) {
    /**
     * No tool chosen. The model's own sentence is used here and only here —
     * it is the "I did not understand" path, where there is no data to be
     * wrong about.
     */
    const said = (message?.content ?? "").trim();
    return {
      spoken: said || "לא הבנתי. אפשר לנסות שוב?",
      actionTaken: "none",
    };
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    // A malformed argument object is the model's error, not the owner's.
    return { spoken: "לא הבנתי. אפשר לנסות שוב?", actionTaken: "none" };
  }

  return runVoiceTool(call.function.name, args, ctx);
}

/**
 * Step 3 — the sentence, spoken.
 *
 * ---------------------------------------------------------------------------
 * **ElevenLabs when it is configured, OpenAI when it is not.** The reason for
 * the switch is the accent: `tts-1` reads Hebrew as a foreign language and it
 * is audible in every reply. ElevenLabs' multilingual model does not, which
 * matters more here than anywhere else in the product — this is the one part of
 * Bazman that a shop's clients might overhear.
 *
 * **The fallback is on failure, not only on absence.** The brief asks for a
 * fallback when the key is missing, and that is the easy half. The half that
 * actually keeps the assistant working is the other one: a quota, a revoked
 * key, a deleted voice or an ElevenLabs outage all arrive as a failed request
 * on a turn the owner is waiting through, and dropping to OpenAI costs them a
 * foreign accent for one sentence instead of silence. Reported rather than
 * swallowed, so a broken configuration is visible in a log rather than only
 * audible to whoever is standing there.
 *
 * Both return base64 mp3, which is what the client already plays — the
 * provider switch reaches nothing beyond this file.
 * ---------------------------------------------------------------------------
 */
export async function speak(text: string): Promise<string> {
  const eleven = elevenLabsConfig();
  if (!eleven) return speakWithOpenAI(text);

  try {
    return await speakWithElevenLabs(text, eleven);
  } catch (error) {
    reportWarning(
      "voice.tts.elevenLabsFallback",
      "ElevenLabs speech failed; falling back to OpenAI",
      { message: error instanceof Error ? error.message : String(error) },
    );
    return speakWithOpenAI(text);
  }
}

async function speakWithElevenLabs(
  text: string,
  { apiKey, voiceId, model }: NonNullable<ReturnType<typeof elevenLabsConfig>>,
): Promise<string> {
  assertVoiceServer();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      headers: {
        // ElevenLabs takes its key in its own header, not as a bearer token.
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        // Default output is mp3 either way; asked for explicitly so a change to
        // their default cannot silently hand the client something it cannot
        // play through `data:audio/mpeg`.
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: model }),
    },
  );

  if (!response.ok) {
    // Their message distinguishes "quota exhausted" from "no such voice", which
    // is the whole value of surfacing it. It never contains the key.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `elevenlabs ${response.status} ${detail.slice(0, 200)}`,
    );
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

/**
 * The original path, kept as the floor rather than deleted.
 *
 * Base64 rather than a streamed body, because the reply is one short sentence
 * and the client plays it whole; a stream would add a second request and a
 * partial-playback state for a two-second clip.
 */
async function speakWithOpenAI(text: string): Promise<string> {
  const response = await openai("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: ttsVoice(),
      input: text,
      response_format: "mp3",
    }),
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}
