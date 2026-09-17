import { NextResponse } from "next/server";

import { db } from "@/db";
import { listServices } from "@/db/queries/services";
import { listActiveStaff } from "@/db/queries/staff";
import { requireBusiness } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { addressGender } from "@/lib/voice/libi-address";
import {
  audioExtension,
  isAcceptedAudioType,
  isVoiceConfigured,
  MAX_AUDIO_BYTES,
} from "@/lib/voice/libi-config";
import { parseHistory } from "@/lib/voice/libi-history";
import {
  upcomingClientNames,
  type PendingAction,
  type VoiceNavigation,
} from "@/lib/voice/libi-tools";
import {
  MAX_CLIENT_KEYWORDS,
  transcriptionContext,
  transcriptionKeywords,
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
   * Somewhere the dashboard should go, when she was asked to *show* rather
   * than to tell. Built server-side from ids this tenant owns — see
   * `VoiceNavigation`.
   */
  navigate?: VoiceNavigation;
  error?: string;
};

/**
 * The pending action the previous turn returned, as the client sent it back.
 *
 * Shape-checked rather than trusted: this is a form field, so it can be
 * anything. The check here is only enough to hand `decide` something of the
 * right type — the *authority* check is `executePending` re-reading the row
 * under this request's own tenant.
 */
function parsePending(raw: unknown): PendingAction | undefined {
  if (typeof raw !== "string" || !raw) return undefined;

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const str = (key: string) => typeof value[key] === "string";
  const shared =
    str("appointmentId") &&
    str("clientName") &&
    str("when") &&
    str("startsAtIso");

  if (!shared) return undefined;
  if (value.kind === "cancel") return value as unknown as PendingAction;

  return value.kind === "reschedule" &&
    str("toWhen") &&
    str("targetStartsAtIso")
    ? (value as unknown as PendingAction)
    : undefined;
}

/**
 * The question a pending action was asked with, for a turn that has no
 * history to read it from.
 *
 * The history's last reply is the exact sentence ליבי spoke and is preferred;
 * this is the fallback, rebuilt from the same fields the card shows.
 */
function pendingQuestion(pending: PendingAction | undefined): string | null {
  if (!pending) return null;
  return pending.kind === "cancel"
    ? `לבטל את התור של ${pending.clientName} ב-${pending.when}?`
    : `להזיז את ${pending.clientName} מ-${pending.when} ל-${pending.toWhen}?`;
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
) {
  return NextResponse.json<VoiceProcessResponse>(
    {
      transcribedText: "",
      textResult,
      audioBase64: null,
      actionTaken: "none",
      ...extra,
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isVoiceConfigured()) {
    // The microphone is not rendered without a key, so reaching this means a
    // key was removed while a tab was open. Said plainly rather than 500.
    return fail(503, "העוזר הקולי לא מוגדר בשרת.", { error: "not_configured" });
  }

  // Redirects when there is no session, exactly like every dashboard route.
  const { business, access } = await requireBusiness();

  let transcribedText = "";

  try {
    const form = await request.formData();
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

    /**
     * A frozen tenant may ask but not change, so the pending action is dropped
     * before it can be confirmed and the writing tools are withheld from the
     * model entirely — a refusal it can phrase is better than a tool that
     * exists and then declines.
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

    /**
     * **The shop's own words, handed to the transcriber before it guesses.**
     *
     * Services, staff, and — the half that was missing — the clients the
     * owner is about to name, nearest first. A general model has never had
     * reason to spell this diary's names the way the diary does, and the
     * tools look them up as written. See `libi-vocabulary`.
     *
     * Read on every turn rather than cached: a client booked a minute ago
     * should be heard correctly now, and three indexed reads in parallel cost
     * far less than the transcription they precede.
     */
    const [shopServices, shopStaff, clients] = await Promise.all([
      listServices(db, business.id),
      listActiveStaff(db, business.id),
      upcomingClientNames(
        {
          db,
          businessId: business.id,
          timezone: business.timezone,
          now: new Date(),
        },
        MAX_CLIENT_KEYWORDS,
      ),
    ]);

    transcribedText = await transcribe(audio, filename, {
      context: transcriptionContext({
        question: history.at(-1)?.replied ?? pendingQuestion(pending),
        gender,
      }),
      keywords: transcriptionKeywords({
        clients,
        staff: shopStaff.map((row) => row.name),
        services: shopServices.map((row) => row.name),
      }),
    });

    if (!transcribedText) {
      /**
       * **Nothing intelligible is not an answer to the question.** The
       * transcriber returns an empty string for a word it could not hear over
       * the clippers, and dropping the pending action here would make the
       * owner's repeated "כן" a yes to nothing. So it is handed back unchanged
       * and the question stays open for one more try.
       */
      return fail(200, "לא שמעתי. אפשר לחזור על זה?", {
        error: "empty_transcript",
        ...(pending ? { pending } : {}),
      });
    }

    const outcome = await decide(
      transcribedText,
      {
        db,
        businessId: business.id,
        timezone: business.timezone,
        now: new Date(),
      },
      writable ? pending : undefined,
      { writable, history, gender },
    );

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

        // Line one, immediately: everything the card needs.
        write({
          type: "text",
          transcribedText,
          textResult: spoken,
          actionTaken: outcome.actionTaken,
          ...(outcome.pending ? { pending: outcome.pending } : {}),
          ...(outcome.navigate ? { navigate: outcome.navigate } : {}),
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
