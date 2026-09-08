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
import { addressGender, type AddressGender } from "./libi-address";
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
import { normalizeForSpeech } from "./libi-hebrew";
import {
  correctHearing,
  transcriptionPrompt,
} from "./libi-vocabulary";
import { splitForSpeech } from "./libi-chunks";
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

/**
 * How ElevenLabs should deliver the line.
 *
 * Named rather than inlined so the two numbers are one thing to change and
 * one thing to find. Both were probed against the live endpoint before being
 * set — the API accepts unknown keys silently, so a typo here would be a
 * setting that simply never applied.
 */
const TTS_VOICE_SETTINGS = { stability: 0.4, speed: 1.1 } as const;

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
export async function transcribe(
  audio: Blob,
  filename: string,
  /**
   * This shop's service and staff names, biasing the decoder toward them.
   *
   * Optional so a caller without them still works, but the route always has
   * them — and they are the half that matters. A general model knows "תור";
   * it has never had reason to learn "מילוי באקריליק" or "ניר בלאק".
   */
  names: readonly string[] = [],
): Promise<string> {
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
  /**
   * **The only place in this pipeline where a mis-heard word can still be**
   * **fixed.** By the time the intent model sees "כהלי" the audio is gone, and
   * no instruction downstream recovers which word was said — it can only guess,
   * which is how a booking lands under a name nobody has. See `libi-vocabulary`.
   */
  form.append("prompt", transcriptionPrompt(names));
  form.append("response_format", "json");

  const response = await openai("/audio/transcriptions", {
    method: "POST",
    body: form,
  });

  const { text } = (await response.json()) as { text?: string };

  /**
   * **Bidi control characters, stripped.** Whisper prefixes a Hebrew
   * transcript with U+202B often enough to matter — it came back as
   * "‫ומה יש לי מחר?" on a live run — and those characters are invisible in
   * every log and every diff. They reach the model as tokens, they reach a
   * word list as a character that is not a letter, and nobody looking at the
   * transcript can see why the turn behaved oddly.
   */
  const clean = (text ?? "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .trim();

  // The net under the bias: a short list of mangles this product has actually
  // seen, corrected as whole words only.
  return correctHearing(clean);
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
 * **Short, and the number is in the prompt because "be concise" is not a
 * length.** Fifteen to twenty words. Every word she says is a word the owner
 * stands still through twice — once while ElevenLabs encodes it and once while
 * it plays — so politeness costs about a second a turn and buys nothing that a
 * person waiting to hear a time wants.
 *
 * **The buffer rule is in the prompt because the code already allows it.**
 * `create_appointment` never consults the availability engine — it checks for a
 * genuine overlap and lets the exclusion constraint settle the rest — so a
 * fifteen-minute gap between 15:05 and 15:20 has always been bookable. What
 * refused it was the *model*, reasoning about padding that does not apply to
 * the owner, in the same way it once invented "אין תורים זמינים" for a booking
 * after closing. Both are the same failure: a model declining on a rule that is
 * the client-facing engine's and not hers.
 *
 * **The minute forms are there because a mis-parsed time reads as a refusal.**
 * "שלוש וחמישה" is 15:05; a model that renders it as 15:00 books over somebody,
 * and one that gives up says there is no room. Neither looks like a parsing
 * problem from the owner's side.
 *
 * **No preamble and no farewell.** "בטח, אני בודקת עכשיו…" is a sentence the
 * owner waits three seconds to hear before the answer; "במה אוכל לעזור עוד?"
 * is one they wait three seconds to hear after it, into a microphone that has
 * already re-opened. Both are forbidden rather than discouraged.
 *
 * **The vocabulary is bounded to the diary.** She is not a general assistant
 * with calendar access; she is the calendar, spoken. Naming the words she has
 * — תור, פנוי, מוזמן, מבוטל, הוזז — is what stops the model editorialising
 * about a day that looks busy.
 * ---------------------------------------------------------------------------
 */
const BASE_INSTRUCTIONS = `את "ליבי", העוזרת הקולית של בזמן. בעל העסק מדבר אלייך בעברית על היומן שלו.

כללים:
- יש כלי שמתאים? קראי לו מיד, בתור הראשון. אל תשאלי שאלות הבהרה שהכלי עצמו שואל.
- get_today_summary הוא **להיום בלבד**. נשאלת על מחר, על אתמול או על יום נקוב? אל תקראי לו — עני מהיומן שלמעלה. תשובה על היום לשאלה על מחר היא הטעות הגרועה ביותר שלך.
- אין כלי מתאים? עני מהיומן שלמעלה בלבד. אל תמציאי דבר; מה שאינו שם — אמרי שאינך רואה אותו.
- **לעולם אל תקריאי רשימה, וזה כולל שלושה תורים.** את נשמעת בקול: בלי מקפים, בלי נקודתיים, בלי "confirmed", בלי שורות.
- יותר משני תורים? אמרי רק כמה יש ומתי הראשון והאחרון. אל תפרטי שמות ושירותים של כולם — אם ירצה, הוא ישאל.
- תור אחד או שניים? שם, שעה, שירות. וזהו.
- תאריכים תמיד YYYY-MM-DD, שעות תמיד HH:MM. תרגמי "היום", "מחר", "ביום חמישי" לתאריך לפי התאריך שלמעלה. לעולם אל תשלחי מילים בשדות האלה.
- שעה בעברית מדוברת היא שעת עסק: "בשלוש" = 15:00, "בשמונה בבוקר" = 08:00.
- דקות נאמרות אחרי "ו": "שלוש וחמישה" = 15:05, "שלוש ועשרים" = 15:20, "שלוש ועשר" = 15:10, "שלוש ורבע" = 15:15, "שלוש וחצי" = 15:30, "רבע לארבע" = 15:45.
- "בין X לבין Y" או "בפער שבין X ל-Y" = קבעי ב-X. זו בקשה מלאה, לא שאלה — שלחי time=X ותני לכלי להחליט.
- **מרווחים ורווחי זמן לא מגבילים אותך.** בעל העסק מדבר אלייך ישירות, והוא רשאי לדחוס תור לכל פער שהוא מבקש. לעולם אל תסרבי בגלל מרווח, רווח בין תורים, או פער שנראה לך קטן. קראי לכלי — רק הוא יודע אם יש התנגשות אמיתית, והוא חוסם רק על חפיפה עם תור קיים.
- שעות הפעילות אינן מגבילות אותך. בעל העסק רשאי לקבוע ולהזיז תורים בכל שעה — שש בבוקר, עשר בלילה, יום סגור. לעולם אל תסרבי בגלל שעה, אל תגידי "אין תורים זמינים" ואל תשאלי אם הוא בטוח. קראי לכלי. רק הכלי מחליט אם יש התנגשות.
- מבקשים לראות תור ביומן ("תראי לי", "תפתחי", "איפה") — show_appointment_in_calendar. הוא פותח את היומן על התור. נאמרה שעה? שלחי אותה. לא נאמרה? אל תשאלי — הכלי לוקח את הראשון באותו יום ואומר מתי.
- טלפון ב-create_appointment אינו חובה. לא הוכתב מספר — אל תבקשי, אל תשאלי, אל תמציאי, פשוט אל תשלחי את השדה.
- **קצר. מקסימום 15–20 מילים בתשובה.** משפט אחד. אם צריך שניים — הראשון קצר.
- בלי הקדמות ובלי אישורי ביניים: לא "רגע", לא "אני בודקת", לא "בטח".
- בלי סיומות נימוס: לא "במה אוכל לעזור עוד?", לא "שמחתי לעזור", לא "בכיף", לא "אני כאן אם תצטרך". סיימת את המשפט — עצרי.
- אוצר המילים שלך הוא יומן ומספרה בלבד: תור, פנוי, מוזמן, מבוטל, הוזז, נקבע, לקוח, שירות, שעה, יום. אל תפרשי, אל תייעצי ואל תעירי הערות על היומן.
- יש שיחה קודמת למעלה? "אותו", "אותה", "זה", "התור הזה", "ואז" ו"גם" מתייחסים לתור שדיברתן עליו בתור הקודם. פתרי את ההתייחסות בעצמך והעבירי לכלי את שם הלקוח שנאמר שם — אל תשאלי "לאיזה תור התכוונת" אם זה ברור מהשיחה.
- המשך של בקשה קודמת הוא בקשה מלאה. "תזיזי אותו שעה קדימה" = הזזה לשעה שהיא שעה אחרי השעה שנאמרה למעלה; חשבי אותה בעצמך ושלחי HH:MM.
- לא הבנת? בקשי שיחזור. אל תנחשי.
- שואלים מי את: "היי, אני ליבי — העוזרת של בזמן."`;

/**
 * The gender half, appended per request.
 *
 * Stated as forms rather than as a label. "Address the owner as female" is an
 * instruction a model can agree with and then ignore three words into a
 * sentence; a list of the actual conjugations is one it can copy. The examples
 * are the verbs she reaches for most — asking, offering, confirming.
 */
const ADDRESS_RULES: Record<AddressGender, string> = {
  male:
    "- פני לבעל העסק בלשון זכר, תמיד. תרצה, תוכל, אמרת, שלך, רוצה, בטוח, קיבלת. לעולם לא תרצי/תוכלי/אמרת בנקבה.",
  female:
    "- פני לבעלת העסק בלשון נקבה, תמיד. תרצי, תוכלי, אמרת, שלך, רוצה, בטוחה, קיבלת. לעולם לא תרצה/תוכל/רוצה בזכר.",
};

/**
 * The full prompt for one request.
 *
 * Exported for its test: the gender half is the only part of this prompt that
 * differs between two tenants, so it is the only part where a wiring mistake
 * would be invisible in every check that does not compare the two.
 */
export function instructionsFor(gender: AddressGender): string {
  return `${BASE_INSTRUCTIONS}
${ADDRESS_RULES[gender]}`;
}

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
    gender,
  }: {
    writable?: boolean;
    history?: readonly Turn[];
    /** The owner's setting, coerced here so a stray value cannot reach a prompt. */
    gender?: string | null;
  } = {},
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

${instructionsFor(addressGender(gender))}`,
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
  const [only] = await Promise.all(speakChunks(text));
  return only ?? "";
}

/**
 * The reply as ordered pieces of audio, each already in flight.
 *
 * ---------------------------------------------------------------------------
 * **Requested together, awaited in order.** Returning promises rather than
 * audio is the whole design: every piece is asked for at once, so the second
 * one is already being generated while the first is being played, and the
 * caller can start streaming the moment the first resolves without knowing
 * anything about the rest.
 *
 * Measured against the live endpoint on a two-sentence reply: **3721ms** to
 * the first playable byte as one request, **1946ms** as two — and 3084ms to
 * the last, so the split is faster end to end as well as sooner to start.
 *
 * **The card and the voice get different text, and this is where they part.**
 * "17:30" is exactly right to read and wrong to hear, so the normalisation
 * happens here and the sentence on screen keeps its numerals. It runs before
 * the split, because pointing a word or spelling out a time changes where the
 * sentence boundaries are.
 * ---------------------------------------------------------------------------
 */
export function speakChunks(text: string): Promise<string>[] {
  const spoken = normalizeForSpeech(text);
  return splitForSpeech(spoken).map((chunk) => speakOne(chunk));
}

/** One piece, with the provider fallback that has always been here. */
async function speakOne(text: string): Promise<string> {
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

  /**
   * **The streaming endpoint, even though the whole clip is still buffered.**
   *
   * It is not the same request with a different body — it is measurably a
   * different one. Against `eleven_v3` on the same sentence: headers at
   * 980ms and the last byte at 1562ms, against 2652ms and 2657ms for the
   * plain endpoint. The generation starts returning while it is still being
   * produced, and that shows up in the total even for a caller who waits.
   *
   * Buffered rather than forwarded because the browser plays these through
   * `decodeAudioData`, which needs a complete file. The incremental half of
   * the problem is solved a level up, by asking for the reply in pieces —
   * see `speakChunks`.
   */
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
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
      body: JSON.stringify({
        text,
        model_id: model,
        /**
         * **Quick without being hurried, and steady enough to be believed.**
         *
         * `speed: 1.1` is about a tenth off every reply — worth having when
         * the owner is standing still through it, and far enough from the
         * point where Hebrew starts to slur. `stability: 0.4` sits below
         * the midpoint on purpose: the higher end flattens the question
         * intonation that makes "?להזיז אותו" sound like a question rather
         * than an announcement, and this assistant asks a lot of them.
         */
        voice_settings: TTS_VOICE_SETTINGS,
      }),
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
