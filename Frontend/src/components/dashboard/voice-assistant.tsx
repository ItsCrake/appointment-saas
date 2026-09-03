"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Mic, Square, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * Bazman Voice — the microphone, the ring, and the card.
 *
 * ---------------------------------------------------------------------------
 * **The ring is CSS, not a motion library.** A conic gradient masked to the rim,
 * swept by an `@property` angle — see `.voice-glow` in `globals.css`. Framer
 * Motion would have been about fifty kilobytes of JavaScript on a dashboard
 * that currently ships nineteen, to animate one border that the compositor can
 * animate on its own. It is also the wrong tool for a full-viewport element on
 * the phones this runs on: a JS-driven paint of that area is exactly what the
 * booking page's ambient blobs were rewritten to avoid.
 *
 * **Hold to talk, or tap to toggle.** A held button is the gesture people
 * already know from every messaging app, and it makes the stop unmissable. Tap
 * is kept for anyone who cannot hold — a hand full of scissors, or a motor
 * impairment — and both end at the same `stop()`.
 *
 * **Nothing is cancelled by voice.** A destructive intent comes back as a
 * proposal and lands on this card as a button with the client's name and time
 * on it. Speech in a barbershop is not a good enough signal to end somebody
 * else's appointment on — see `bazman-tools.ts`.
 * ---------------------------------------------------------------------------
 */
type Phase = "idle" | "recording" | "processing" | "speaking";

type Proposal = {
  kind: "cancel";
  appointmentId: string;
  clientName: string;
  when: string;
};

type Result = {
  transcribedText: string;
  textResult: string;
  audioBase64: string | null;
  actionTaken: string;
  proposal?: Proposal;
  error?: string;
};

/** Past this, stop on our own: a pocket recording is a bill, not a question. */
const MAX_RECORDING_MS = 20_000;

/**
 * Shorter than this and the press was a tap, not a hold — so releasing does not
 * end the recording. Long enough to survive a slow finger, short enough that a
 * deliberate hold is never mistaken for one.
 */
const TAP_MS = 400;

export function VoiceAssistant() {
  const { toast } = useToast();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, startConfirm] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the current press began, so a tap and a hold can be told apart. */
  const pressedAtRef = useRef(0);

  /**
   * Whether this browser can record at all.
   *
   * `MediaRecorder` is a capability of the environment, so it is read as an
   * external store rather than copied into state by a mount effect — the same
   * shape the calendar's density preference uses, and for the same two
   * reasons. The server snapshot is `false`, so the markup it produces and the
   * markup hydration expects agree; and there is no render pass whose only job
   * is correcting the one before it. The capability never changes, so
   * `subscribe` has nothing to listen to.
   */
  const supported = useSyncExternalStore(
    () => () => {},
    () =>
      typeof window.MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    () => false,
  );

  /** Releases the microphone. The browser's recording indicator is a promise. */
  const releaseStream = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      releaseStream();
      audioRef.current?.pause();
    };
  }, [releaseStream]);

  const send = useCallback(
    async (audio: Blob) => {
      setPhase("processing");

      const form = new FormData();
      // The extension is decided server-side from the MIME type — Whisper
      // dispatches on the filename, and the container differs by browser.
      form.append("audio", audio, "speech");

      try {
        const response = await fetch("/api/voice/process", {
          method: "POST",
          body: form,
        });
        const body = (await response.json()) as Result;
        setResult(body);

        if (body.audioBase64) {
          const audioEl = new Audio(
            `data:audio/mpeg;base64,${body.audioBase64}`,
          );
          audioRef.current = audioEl;
          setPhase("speaking");
          audioEl.onended = () => setPhase("idle");
          // Autoplay after a user gesture is allowed, but a refusal must not
          // strand the ring on — the card still carries the answer in text.
          audioEl.play().catch(() => setPhase("idle"));
        } else {
          setPhase("idle");
        }
      } catch {
        setResult({
          transcribedText: "",
          textResult: "לא הצלחתי להגיע לשרת. כדאי לנסות שוב.",
          audioBase64: null,
          actionTaken: "none",
          error: "network",
        });
        setPhase("idle");
      }
    },
    [],
  );

  const stop = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (phase !== "idle") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        releaseStream();
        // A tap that lands and lifts in the same instant produces a few bytes
        // of silence; sending it costs a model call to be told nothing.
        if (blob.size < 1024) {
          setPhase("idle");
          return;
        }
        void send(blob);
      };

      recorder.start();
      setResult(null);
      setPhase("recording");
      stopTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      // Denied, or no device. Both are the owner's to fix and neither is worth
      // a thrown error in a dashboard.
      toast("אין גישה למיקרופון. אפשר לאשר בהגדרות הדפדפן.", "error");
      setPhase("idle");
    }
  }, [phase, releaseStream, send, stop, toast]);

  function confirmCancel(proposal: Proposal) {
    startConfirm(async () => {
      const outcome = await setAppointmentStatusAction(
        proposal.appointmentId,
        "cancelled",
      );
      if (outcome.ok) {
        toast(`${proposal.clientName}: התור בוטל`);
        setResult(null);
        router.refresh();
      } else {
        toast(outcome.error, "error");
      }
    });
  }

  // No recorder, no button. The same rule Libi follows: a control that appears
  // to work and does not is how trust in every other control goes.
  if (!supported) return null;

  const active = phase === "recording" || phase === "processing";

  return (
    <>
      {active ? (
        <div aria-hidden className="voice-glow" data-phase={phase} />
      ) : null}

      {/* One live region for the whole exchange, so a screen reader hears the
          transcript and the answer as they arrive rather than not at all. */}
      <div aria-live="polite" className="sr-only">
        {phase === "recording"
          ? "מקליט"
          : phase === "processing"
            ? "מעבד"
            : (result?.textResult ?? "")}
      </div>

      {result ? (
        <div
          className={cn(
            "animate-sheet fixed inset-x-3 z-50 mx-auto max-w-lg rounded-2xl border p-4 shadow-lg backdrop-blur",
            "border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-900/95",
            // Clears the mobile bottom bar and the microphone above it.
            "bottom-[calc(9rem_+_env(safe-area-inset-bottom))] md:bottom-24",
          )}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {result.transcribedText ? (
                <p className="truncate text-xs text-zinc-500">
                  שמעתי: &laquo;{result.transcribedText}&raquo;
                </p>
              ) : null}
              <p className="mt-1 text-sm leading-relaxed font-semibold text-zinc-900 dark:text-zinc-50">
                {result.textResult}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="סגירה"
              className="-me-1 shrink-0 rounded-lg p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* The write, and the only place one happens. The name and the time
              are on the button, so the thing being confirmed is the thing
              being read. */}
          {result.proposal ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={confirming}
                onClick={() => confirmCancel(result.proposal!)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {confirming ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-3.5" aria-hidden />
                )}
                ביטול התור של {result.proposal.clientName} ב-{result.proposal.when}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="h-9 rounded-lg px-3 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                לא עכשיו
              </button>
            </div>
          ) : null}

          {result.error && result.error !== "empty_transcript" ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {result.error === "not_configured"
                ? "העוזר הקולי לא מוגדר בשרת."
                : "משהו השתבש בדרך."}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        /**
         * **Hold to talk, or tap to toggle — and the two must not fight.**
         *
         * The first cut wired `onPointerDown` to start and `onClick` to
         * toggle, which meant one tap started the recording and the click that
         * followed a few milliseconds later stopped it. The ring appeared and
         * vanished, and the only reason it was caught is that a browser check
         * read `aria-pressed` back.
         *
         * Now the pointer owns the gesture: press begins, and release ends it
         * only if the press was long enough to have been a hold. A quick tap
         * leaves it recording, and the next press stops it.
         */
        onPointerDown={() => {
          if (phase === "recording") {
            stop();
            return;
          }
          pressedAtRef.current = Date.now();
          void start();
        }}
        onPointerUp={() => {
          const held = Date.now() - pressedAtRef.current;
          if (phase === "recording" && held > TAP_MS) stop();
        }}
        /**
         * Keyboard only. A pointer-driven click reports `detail >= 1`; Enter
         * and Space on a focused button report `0`, and that is the one case
         * the handlers above never see.
         */
        onClick={(event) => {
          if (event.detail !== 0) return;
          if (phase === "recording") stop();
          else void start();
        }}
        disabled={phase === "processing" || phase === "speaking"}
        aria-label={phase === "recording" ? "עצירת ההקלטה" : "דיבור עם בזמן"}
        aria-pressed={phase === "recording"}
        className={cn(
          "fixed end-4 z-50 flex size-14 items-center justify-center rounded-full text-white shadow-lg transition-transform",
          "bottom-[calc(5rem_+_env(safe-area-inset-bottom))] md:bottom-8",
          "focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-zinc-100",
          "disabled:opacity-70 motion-safe:active:scale-95",
          phase === "recording"
            ? "bg-red-600"
            : "bg-[image:var(--brand-gradient)]",
        )}
      >
        {phase === "processing" || phase === "speaking" ? (
          <Loader2 className="size-6 animate-spin" aria-hidden />
        ) : phase === "recording" ? (
          <Square className="size-5 fill-current" aria-hidden />
        ) : (
          <Mic className="size-6" aria-hidden />
        )}
      </button>
    </>
  );
}
