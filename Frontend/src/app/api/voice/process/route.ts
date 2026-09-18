import { after, NextResponse } from "next/server";

import { db } from "@/db";
import { listServices } from "@/db/queries/services";
import { listActiveStaff } from "@/db/queries/staff";
import { settleAftermath } from "@/lib/appointment-aftermath";
import { requireBusiness } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { addressGender } from "@/lib/voice/libi-address";
import {
  carriedQuestion,
  parseDraft,
  parsePending,
} from "@/lib/voice/libi-carry";
import {
  audioExtension,
  isAcceptedAudioType,
  isVoiceConfigured,
  MAX_AUDIO_BYTES,
} from "@/lib/voice/libi-config";
import { parseHistory } from "@/lib/voice/libi-history";
import {
  upcomingClientNames,
  upcomingRoster,
  type DiaryChange,
  type DraftAction,
  type PendingAction,
  type VoiceNavigation,
} from "@/lib/voice/libi-tools";
import {
  MAX_CLIENT_KEYWORDS,
  transcriptionContext,
  transcriptionKeywords,
  type VocabularySources,
} from "@/lib/voice/libi-vocabulary";
import { decide, speakChunks, transcribe } from "@/lib/voice/libi-voice";

/**
 * `/api/voice/process` — one spoken turn.
 *
 * ---------------------------------------------------------------------------
 * **Authenticated by the owner's own session, not by a token.** This is the
 * opposite of the Apple Shortcuts endpoint it replaces, and deliberately so:
 * the caller here is the dashboard the owner is already signed into, so
 * `requireBusiness()` resolves the tenant the same way every other dashboard
 * route does. There is no new credential to mint, leak, or revoke, and a
 * request from anywhere else is simply not signed in.
 *
 * **This path writes now, so it carries its own freeze gate.** It used to be
 * purely advisory — cancelling was proposed and applied by a dashboard action
 * that gated on writability — and `requireBusiness` was enough. Booking a slot
 * and applying a confirmed move happen here, so the check happens here too,
 * inline rather than through `requireWritable`: that helper *redirects*, which
 * on a `fetch` for NDJSON means a login page arriving where a JSON line was
 * expected. A frozen tenant gets a spoken refusal and can still ask questions,
 * which is exactly what the freeze means.
 *
 * Note the gate is on the *turn*, not on the tool: a read-only question from a
 * frozen tenant is answered normally, and only the writing tools are withheld.
 *
 * **The transcript is returned even when a later step fails.** "It thought I
 * said Dana" is something an owner can act on; "it did not work" is not.
 *
 * **Two lines of NDJSON, not one JSON object.** The answer is known about two
 * seconds before it can be spoken, and holding it back until the audio is
 * encoded made the whole turn feel as slow as its slowest step. The first line
 * carries the transcript, the sentence and any proposal — the card renders off
 * that — and the second carries the audio when it arrives.
 *
 * A stream rather than a second endpoint, deliberately. Splitting TTS into its
 * own route would mean shipping the sentence back to the server to be spoken,
 * which is a second round trip *and* an endpoint that will read any text a
 * signed-in caller hands it. Here the only thing that can be spoken is
 * something this request already produced.
 * ---------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";
/** OpenAI calls plus a Postgres pool; the edge runtime has neither. */
export const runtime = "nodejs";
/** Three sequential model calls. The platform default is not enough. */
export const maxDuration = 60;

export type VoiceProcessResponse = {
  transcribedText: string;
  textResult: string;
  audioBase64: string | null;
  actionTaken: string;
  /**
   * A change described and awaiting a spoken answer. The client holds it and
   * sends it back with the next recording — see `PendingAction`, which explains
   * why nothing in it is trusted on the way in.
   */
  pending?: PendingAction;
  /**
   * A change she began and asked one more detail about. Carried by the
   * client and sent back with the next recording, exactly as `pending` is —
   * see `DraftAction`.
   */
  draft?: DraftAction;
  /**
   * Somewhere the dashboard should go, when she was asked to *show* rather
   * than to tell. Built server-side from ids this tenant owns — see
   * `VoiceNavigation`.
   */
  navigate?: VoiceNavigation;
  /**
   * The diary changed this turn, so whatever is on screen is out of date. The
   * client re-renders the route — see `DiaryChange`.
   */
  changed?: DiaryChange;
  error?: string;
};

/**
 * How long one shop's vocabulary is reused.
 *
 * ---------------------------------------------------------------------------
 * **A conversation is several turns a few seconds apart**, and each one used
 * to read the same three lists again before it could transcribe anything —
 * from a function in Frankfurt to a database in Seoul, a quarter of a second
 * or more before the audio could even be sent. Half a minute covers a
 * conversation and nothing much longer.
 *
 * **What staleness costs is a hint, not an answer.** These lists only bias the
 * transcriber; a client booked twenty seconds ago who is missing from them is
 * still found by the tools, exactly or near. Per warm instance, per shop —
 * nothing crosses tenants, and an instance that is recycled simply reads again.
 * ---------------------------------------------------------------------------
 */
const VOCABULARY_TTL_MS = 30_000;
const vocabularyCache = new Map<
  string,
  { at: number; value: Promise<VocabularySources> }
>();

function vocabularyFor(ctx: {
  db: typeof db;
  businessId: string;
  timezone: string;
  now: Date;
}): Promise<VocabularySources> {
  const now = Date.now();
  const hit = vocabularyCache.get(ctx.businessId);
  if (hit && now - hit.at < VOCABULARY_TTL_MS) return hit.value;

  // Expired entries go when a new one is written, so the map stays the size
  // of the shops that spoke in the last half minute.
  for (const [key, entry] of vocabularyCache) {
    if (now - entry.at >= VOCABULARY_TTL_MS) vocabularyCache.delete(key);
  }

  const value = Promise.all([
    listServices(ctx.db, ctx.businessId),
    listActiveStaff(ctx.db, ctx.businessId),
    upcomingClientNames(ctx, MAX_CLIENT_KEYWORDS),
  ]).then(([services, staff, clients]) => ({
    clients,
    staff: staff.map((row) => row.name),
    services: services.map((row) => row.name),
  }));
  vocabularyCache.set(ctx.businessId, { at: now, value });
  // A failed read must not be served to the next turn.
  value.catch(() => vocabularyCache.delete(ctx.businessId));
  return value;
}

/**
 * Where a turn's time went, as a `Server-Timing` header.
 *
 * A header rather than a log line: it costs nothing when nobody is looking,
 * and it is exactly where somebody measuring a slow turn already is — the
 * browser's network panel, or a test reading the response. Each mark is the
 * time since the previous one; `total` is since the request arrived.
 */
function stageTimer() {
  const started = performance.now();
  let last = started;
  const stages: string[] = [];
  return {
    mark(name: string) {
      const now = performance.now();
      stages.push(`${name};dur=${Math.round(now - last)}`);
      last = now;
    },
    header() {
      const total = Math.round(performance.now() - started);
      return [...stages, `total;dur=${total}`].join(", ");
    },
  };
}

/**
 * A refusal is one JSON object, not a stream.
 *
 * There is nothing to wait for — no audio is coming — and a client that has to
 * parse two shapes for the error path would be parsing a stream to find out
 * there is no stream.
 */
function fail(
  status: number,
  textResult: string,
  extra: Partial<VoiceProcessResponse> = {},
  serverTiming?: string,
) {
  return NextResponse.json<VoiceProcessResponse>(
    {
      transcribedText: "",
      textResult,
      audioBase64: null,
      actionTaken: "none",
      ...extra,
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(serverTiming ? { "Server-Timing": serverTiming } : {}),
      },
    },
  );
}

export async function POST(request: Request) {
  if (!isVoiceConfigured()) {
    // The microphone is not rendered without a key, so reaching this means a
    // key was removed while a tab was open. Said plainly rather than 500.
    return fail(503, "העוזר הקולי לא מוגדר בשרת.", { error: "not_configured" });
  }

  const timing = stageTimer();

  // Redirects when there is no session, exactly like every dashboard route.
  const { business, access } = await requireBusiness();
  timing.mark("auth");

  let transcribedText = "";

  try {
    const form = await request.formData();
    timing.mark("upload");
    const audio = form.get("audio");

    if (!(audio instanceof Blob) || audio.size === 0) {
      return fail(400, "לא קיבלתי הקלטה.", { error: "missing_audio" });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      // Charged by the minute, so the cap is before the upload leaves us.
      return fail(413, "ההקלטה ארוכה מדי. נסו משפט קצר יותר.", {
        error: "audio_too_large",
      });
    }

    if (!isAcceptedAudioType(audio.type)) {
      return fail(415, "פורמט ההקלטה לא נתמך בדפדפן הזה.", {
        error: "unsupported_audio_type",
      });
    }

    /**
     * The extension has to match the container or the upload is refused — the
     * API dispatches on the filename, not on the MIME type. `MediaRecorder`
     * gives webm on Chrome and mp4 on Safari, so the name is derived rather
     * than fixed, through a map rather than the raw subtype.
     */
    const filename = `speech.${audioExtension(audio.type)}`;

    const pending = parsePending(form.get("pending"));
    const draft = parseDraft(form.get("draft"));

    /**
     * A frozen tenant may ask but not change, so the pending action and any
     * half-finished draft are dropped before they can be completed, and the
     * writing tools are withheld from the model entirely — a refusal it can
     * phrase is better than a tool that exists and then declines.
     */
    const writable = access === "full";

    /**
     * The exchange so far, as the client has been keeping it.
     *
     * Bounded and shape-checked on the way in — see `libi-history`, which also
     * explains why untrusted history is safe here and what it cannot reach.
     * Read *before* transcribing now, because ליבי's last sentence is the
     * transcriber's best context: "כן" is a hard word to hear in a loud room
     * and an easy one after "לבטל אותו?".
     */
    const history = parseHistory(form.get("history"), Date.now());
    const gender = addressGender(business.libiAddressGender);

    const toolContext = {
      db,
      businessId: business.id,
      timezone: business.timezone,
      now: new Date(),
      hasMultipleStaff: business.hasMultipleStaff,
    };

    /**
     * **The diary is read while the audio is being heard.** The model needs
     * the week's roster whatever was said, so waiting for the transcript
     * before asking for it was a database round trip spent standing still.
     * Started here, it lands with the transcript; a turn that turns out to be
     * a "כן" never reads it, which costs one indexed query. The `catch` only
     * marks it handled — `decide` still sees a failure when it awaits.
     */
    const roster = upcomingRoster(toolContext);
    roster.catch(() => {});

    /**
     * **The shop's own words, handed to the transcriber before it guesses.**
     *
     * Services, staff, and — the half that was missing — the clients the
     * owner is about to name, nearest first. A general model has never had
     * reason to spell this diary's names the way the diary does, and the
     * tools look them up as written. See `libi-vocabulary` and
     * `vocabularyFor`.
     */
    const vocabulary = await vocabularyFor(toolContext);
    timing.mark("ctx");

    transcribedText = await transcribe(audio, filename, {
      context: transcriptionContext({
        question: history.at(-1)?.replied ?? carriedQuestion(pending, draft),
        gender,
      }),
      keywords: transcriptionKeywords(vocabulary),
    });
    timing.mark("stt");

    if (!transcribedText) {
      /**
       * **Nothing intelligible is not an answer to the question.** The
       * transcriber returns an empty string for a word it could not hear over
       * the clippers, and dropping the pending action here would make the
       * owner's repeated "כן" a yes to nothing. So it is handed back unchanged
       * — and a draft with it — and the question stays open for one more try.
       */
      return fail(
        200,
        "לא שמעתי. אפשר לחזור על זה?",
        {
          error: "empty_transcript",
          ...(pending ? { pending } : {}),
          ...(draft ? { draft } : {}),
        },
        timing.header(),
      );
    }

    const outcome = await decide(
      transcribedText,
      toolContext,
      writable ? pending : undefined,
      {
        writable,
        history,
        gender,
        roster,
        draft: writable ? draft : undefined,
        onStage: (stage) => timing.mark(stage),
      },
    );

    /**
     * **What the write still owes, once the owner has their answer.** A moved
     * appointment's reminder is re-planned, a cancelled client is told, a
     * freed slot is offered to the waitlist — several round trips to a
     * database a continent away, none of which changes what ליבי says. So it
     * runs after the response rather than in front of her voice. `after` is
     * the platform's promise that it still runs; `settleAftermath` swallows
     * and reports its own failures, since the change it follows has already
     * been written.
     */
    if (outcome.aftermath?.length) {
      const owed = outcome.aftermath;
      after(() =>
        settleAftermath({ db, business, source: "voice", owed }),
      );
    }

    const spoken = outcome.spoken;
    const encoder = new TextEncoder();
    /** NDJSON is newline-delimited; naming it keeps the escape out of a template. */
    const NEWLINE = String.fromCharCode(10);

    /**
     * **The owner may leave mid-answer**, and the stream must notice. Closing
     * the card, navigating away or losing the network cancels it; writing to
     * a cancelled stream throws, and that throw used to be caught by the
     * speech handler and reported as a *speech* failure — twice, since the
     * handler wrote again. Every write now goes through `write`, which knows.
     */
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (line: object) => {
          if (cancelled) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(line) + NEWLINE));
          } catch {
            cancelled = true;
          }
        };

        /**
         * Line one, immediately: everything the card needs — and `changed`,
         * which is what puts a booking she just took on the calendar behind
         * the card before she has finished saying so. Named fields only:
         * `aftermath` holds whole appointment rows and stays on this side.
         */
        write({
          type: "text",
          transcribedText,
          textResult: spoken,
          actionTaken: outcome.actionTaken,
          ...(outcome.pending ? { pending: outcome.pending } : {}),
          ...(outcome.draft ? { draft: outcome.draft } : {}),
          ...(outcome.navigate ? { navigate: outcome.navigate } : {}),
          ...(outcome.changed ? { changed: outcome.changed } : {}),
        });

        /**
         * The voice, in the pieces it can be spoken in.
         *
         * **All of them are already in flight**; this only writes them out as
         * they land, in order, so the client can start playing the first while
         * the rest are still being generated. Measured on a two-sentence reply,
         * that is 1946ms to the first sound instead of 3721ms.
         *
         * Speech is best-effort: a failed call must not lose an answer the
         * owner can already read, so a null audio line says so and the card
         * stays as it is. `last` is what tells the client the queue is closed —
         * without it there is no moment at which the microphone may reopen.
         */
        const clips = speakChunks(spoken);
        // A clip nobody reads any more — the owner left — must not surface
        // as an unhandled rejection. The loop below still sees each failure.
        for (const clip of clips) clip.catch(() => {});

        if (clips.length === 0) {
          write({ type: "audio", audioBase64: null, last: true });
        }

        for (const [index, clip] of clips.entries()) {
          if (cancelled) break;
          const last = index === clips.length - 1;
          try {
            write({ type: "audio", audioBase64: await clip, last });
          } catch (error) {
            reportError("voice.tts", error, { businessId: business.id });
            write({ type: "audio", audioBase64: null, last });
          }
        }

        if (!cancelled) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "private, no-store",
        // Tells a proxy that buffers by default not to. Without it the two
        // lines arrive together and the split buys nothing.
        "X-Accel-Buffering": "no",
        "Server-Timing": timing.header(),
      },
    });
  } catch (error) {
    // The owner left before the upload finished. Nobody is waiting for an
    // answer, and it is not a failure worth an alert.
    const disconnected =
      request.signal.aborted ||
      (error instanceof Error &&
        error.message === "aborted" &&
        (error as { code?: string }).code === "ECONNRESET");
    if (disconnected) return new Response(null, { status: 499 });
    reportError("voice.process", error, { businessId: business.id });
    return fail(500, "לא הצלחתי לעבד את ההקלטה. כדאי לנסות שוב.", {
      transcribedText,
      error: "internal",
    });
  }
}
