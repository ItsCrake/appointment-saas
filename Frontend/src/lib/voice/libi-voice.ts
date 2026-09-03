import {
  assertVoiceServer,
  INTENT_MODEL,
  STT_MODEL,
  TTS_MODEL,
  ttsVoice,
  voiceApiKey,
} from "./libi-config";
import {
  VOICE_TOOLS,
  runVoiceTool,
  upcomingRoster,
  type ToolContext,
  type ToolOutcome,
} from "./libi-tools";
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
 * **The tools stay authoritative and the prompt says so.** With the roster in
 * front of it, a model will happily answer "מה התור הבא שלי?" from the list —
 * and its sentence would be plausible, ungrounded prose where the tool's is
 * exact, tested Hebrew with the shop's own counting and time formatting. So the
 * ordering is stated: use a tool when one fits, and read from the diary only
 * for the questions no tool covers.
 */
const INSTRUCTIONS = `את "ליבי", העוזרת הקולית של בזמן — מערכת ניהול תורים לעסקים בישראל.
בעל העסק מדבר אלייך בעברית ושואל על היומן שלו.

כללים:
- כשיש כלי שמתאים לשאלה — השתמשי בו. הכלים הם המקור המדויק.
- לשאלות שאין להן כלי (למשל "מה יש לי ביום חמישי?" או "בשביל מה התור ב-15:00?") — עני מתוך היומן שקיבלת למעלה בלבד.
- אל תמציאי שום פרט שאינו מופיע ברשימה. אם משהו לא שם, אמרי שאינך רואה אותו ביומן.
- אם המשתמש מבקש לבטל תור, השתמשי ב-propose_cancel_appointment. את לא מבטלת בעצמך.
- אם המשתמש מבקש לקבוע או להזיז תור, הסבירי בקצרה שצריך לעשות זאת ביומן עצמו.
- אם לא הבנת, בקשי שיחזור — אל תנחשי.
- עני במשפט אחד קצר בעברית, מתאים להקראה בקול.
- אם שואלים מי את, עני: "היי, אני ליבי — העוזרת של בזמן."`;

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
): Promise<ToolOutcome> {
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
    { role: "user", content: transcript },
  ];

  const response = await openai("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: INTENT_MODEL,
      messages,
      tools: VOICE_TOOLS,
      tool_choice: "auto",
      // Zero, and it matters more now that the model can read the diary: this
      // is the difference between reading a row back and paraphrasing it.
      temperature: 0,
      max_tokens: 200,
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
 * Base64 rather than a streamed body, because the reply is one short sentence
 * and the client plays it as a whole: a stream would add a second request and
 * a partial-playback state for a two-second clip. MP3 because every browser
 * that can record can play it.
 */
export async function speak(text: string): Promise<string> {
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
