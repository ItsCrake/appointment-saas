import { NextResponse } from "next/server";

import { db } from "@/db";
import { listServices } from "@/db/queries/services";
import { listActiveStaff } from "@/db/queries/staff";
import { requireBusiness } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import {
  isAcceptedAudioType,
  isVoiceConfigured,
  MAX_AUDIO_BYTES,
} from "@/lib/voice/libi-config";
import { parseHistory } from "@/lib/voice/libi-history";
import type {
  PendingAction,
  VoiceNavigation,
} from "@/lib/voice/libi-tools";
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
     * The extension has to match the container or Whisper rejects the upload —
     * it dispatches on the filename, not on the MIME type. `MediaRecorder`
     * gives webm on Chrome and mp4 on Safari, so the name is derived rather
     * than fixed.
     */
    const extension = audio.type.split(";")[0].split("/")[1] ?? "webm";

    /**
     * **The shop's own nouns, handed to the transcriber before it guesses.**
     *
     * A general model knows "תור" and has never had reason to learn "מילוי
     * באקריליק" or the name of the person holding the scissors. These are the
     * words it gets wrong, and the decoder is the only place left where a
     * wrong one can still be reconsidered — see `libi-vocabulary`.
     *
     * Read on every turn rather than cached: a service renamed this morning
     * should be heard correctly this afternoon, and the two queries cost less
     * than the transcription they precede.
     */
    const [shopServices, shopStaff] = await Promise.all([
      listServices(db, business.id),
      listActiveStaff(db, business.id),
    ]);

    transcribedText = await transcribe(audio, `speech.${extension}`, [
      ...shopServices.map((row) => row.name),
      ...shopStaff.map((row) => row.name),
    ]);

    if (!transcribedText) {
      return fail(200, "לא שמעתי כלום. אפשר לנסות שוב?", {
        error: "empty_transcript",
      });
    }

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
     */
    const history = parseHistory(form.get("history"), Date.now());

    const outcome = await decide(
      transcribedText,
      {
        db,
        businessId: business.id,
        timezone: business.timezone,
        now: new Date(),
      },
      writable ? pending : undefined,
      { writable, history, gender: business.libiAddressGender },
    );

    const spoken = outcome.spoken;
    const encoder = new TextEncoder();
    /** NDJSON is newline-delimited; naming it keeps the escape out of a template. */
    const NEWLINE = String.fromCharCode(10);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Line one, immediately: everything the card needs.
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "text",
              transcribedText,
              textResult: spoken,
              actionTaken: outcome.actionTaken,
              ...(outcome.pending ? { pending: outcome.pending } : {}),
              ...(outcome.navigate ? { navigate: outcome.navigate } : {}),
            }) + NEWLINE,
          ),
        );

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
        const pending = speakChunks(spoken);

        if (pending.length === 0) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "audio", audioBase64: null, last: true }) +
                NEWLINE,
            ),
          );
        }

        for (const [index, chunk] of pending.entries()) {
          const last = index === pending.length - 1;
          try {
            const audioBase64 = await chunk;
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "audio", audioBase64, last }) + NEWLINE,
              ),
            );
          } catch (error) {
            reportError("voice.tts", error, { businessId: business.id });
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "audio", audioBase64: null, last }) +
                  NEWLINE,
              ),
            );
          }
        }

        controller.close();
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
    reportError("voice.process", error, { businessId: business.id });
    return fail(500, "לא הצלחתי לעבד את ההקלטה. כדאי לנסות שוב.", {
      transcribedText,
      error: "internal",
    });
  }
}
