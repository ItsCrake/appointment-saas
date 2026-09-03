import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireBusiness } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import {
  isAcceptedAudioType,
  isVoiceConfigured,
  MAX_AUDIO_BYTES,
} from "@/lib/voice/libi-config";
import { decide, speak, transcribe } from "@/lib/voice/libi-voice";

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
 * `requireBusiness` rather than `requireWritable`: nothing on this path writes.
 * Cancelling is *proposed* and the confirmation goes through the dashboard's
 * own action, which does gate on writability — so a frozen tenant can ask
 * questions and cannot change anything, which is exactly what the freeze means.
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
  proposal?: {
    kind: "cancel";
    appointmentId: string;
    clientName: string;
    when: string;
  };
  error?: string;
};

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
  const { business } = await requireBusiness();

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
    transcribedText = await transcribe(audio, `speech.${extension}`);

    if (!transcribedText) {
      return fail(200, "לא שמעתי כלום. אפשר לנסות שוב?", {
        error: "empty_transcript",
      });
    }

    const outcome = await decide(transcribedText, {
      db,
      businessId: business.id,
      timezone: business.timezone,
      now: new Date(),
    });

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
              ...(outcome.proposal ? { proposal: outcome.proposal } : {}),
            }) + NEWLINE,
          ),
        );

        /**
         * Line two, when the voice is ready. Speech is best-effort: a failed
         * TTS call must not lose an answer the owner can already read, so the
         * audio line simply says so and the card stays as it is.
         */
        try {
          const audioBase64 = await speak(spoken);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "audio", audioBase64 }) + NEWLINE),
          );
        } catch (error) {
          reportError("voice.tts", error, { businessId: business.id });
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "audio", audioBase64: null }) + NEWLINE),
          );
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
