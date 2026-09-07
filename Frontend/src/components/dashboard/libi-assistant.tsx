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

import {
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
} from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  decideIdle,
  decideSilence,
  frameLevel,
  INITIAL_SILENCE_STATE,
} from "@/lib/voice/libi-vad";

/**
 * ליבי — the microphone, the ring, and the card.
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
 * **Nothing destructive happens on one sentence.** A move or a cancellation
 * comes back described but unapplied: ליבי reads back the client and the time
 * she found, this card shows the same thing on a button, and the change lands
 * only once the owner has answered — spoken, or tapped. Speech in a barbershop
 * is not a good enough signal on its own to end somebody else's appointment.
 *
 * **The pending change round-trips through here**, because the endpoint holds
 * no session state. It rides along with the next recording so that "כן" has
 * something to be a yes *to*, and the server re-reads the appointment before
 * writing — see `PendingAction` in `libi-tools.ts`.
 *
 * Booking is the exception and runs on the first sentence: it takes an empty
 * slot rather than undoing an arrangement somebody is relying on.
 *
 * **The microphone re-opens when she finishes speaking, not when she answers.**
 * The reply is on screen about three seconds before it finishes being spoken,
 * and re-opening then would have the analyser hear her own voice through the
 * speaker, latch, and cut the owner's turn short before they had said a word.
 * `onended` is the only moment the room is quiet again.
 *
 * **A turn nobody asked for gets a deadline.** `decideSilence`'s latch never
 * stops a recording before somebody has spoken — right for a pressed turn,
 * wrong for one that opened by itself, where it would hold the microphone to
 * the twenty-second cap and then send the shop to Whisper. `decideIdle` closes
 * the conversation instead, and only ever on a continued turn.
 * ---------------------------------------------------------------------------
 */
type Phase = "idle" | "recording" | "processing" | "speaking";

/**
 * One exchange, kept so the next one can refer to it.
 *
 * The endpoint holds no session state, so "תזיז אותו" only has something to
 * point at because this list travels with the recording. Bounded server-side
 * on the way in rather than here — see `libi-history`.
 */
type Turn = { said: string; replied: string; at: number };

/**
 * A change ליבי has described and is waiting to be told to make.
 *
 * Held here between turns because the endpoint is stateless: the recording that
 * answers "כן" is a separate request, and this rides along with it. The server
 * re-reads the appointment before touching anything, so what is stored here is
 * a description rather than permission — see `PendingAction` in `libi-tools`.
 */
type Pending =
  | {
      kind: "cancel";
      appointmentId: string;
      clientName: string;
      when: string;
      startsAtIso: string;
    }
  | {
      kind: "reschedule";
      appointmentId: string;
      clientName: string;
      when: string;
      toWhen: string;
      startsAtIso: string;
      targetStartsAtIso: string;
      targetDate: string;
      targetTime: string;
    };

type Result = {
  transcribedText: string;
  textResult: string;
  audioBase64: string | null;
  actionTaken: string;
  pending?: Pending;
  error?: string;
};

/** Past this, stop on our own: a pocket recording is a bill, not a question. */
const MAX_RECORDING_MS = 20_000;

/**
 * How many exchanges the client bothers to keep.
 *
 * Matched to what the server will actually use, so the difference is not
 * uploaded on every turn to be discarded on arrival. The server bounds it
 * again regardless — its number is the one that matters, and it also applies
 * the inactivity window, which is what makes a stale conversation safe even
 * when this tab has been open since lunch.
 */
const MAX_CLIENT_TURNS = 4;



/** NDJSON's delimiter, named so no template has to escape it. */
const NEWLINE = String.fromCharCode(10);

/**
 * Shorter than this and the press was a tap, not a hold — so releasing does not
 * end the recording. Long enough to survive a slow finger, short enough that a
 * deliberate hold is never mistaken for one.
 */
const TAP_MS = 400;

export function LibiAssistant() {
  const { toast } = useToast();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, startConfirm] = useTransition();
  /**
   * Mirrors `conversingRef` for the sake of the badge on the card.
   *
   * The ref is what the audio callback reads; this is what React renders. Two
   * copies of one fact again, and kept in step by `setConversing` below being
   * the only writer of either.
   */
  const [conversing, setConversingState] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the current press began, so a tap and a hold can be told apart. */
  const pressedAtRef = useRef(0);
  /** Kept across turns: closing it would need another gesture to unlock. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<{ stop: () => void } | null>(null);
  /**
   * The change awaiting an answer, mirrored out of state.
   *
   * `send` is memoised for the life of the recorder, so it cannot read
   * `result` — that closure is built before the question is even asked. A ref
   * is the value as it is *now*, which is the only version an answer can be an
   * answer to.
   */
  const pendingRef = useRef<Pending | null>(null);
  /**
   * The conversation so far, for the same reason and by the same route as
   * `pendingRef`: `send` is memoised for the life of the recorder and cannot
   * read state that changed after it was built.
   */
  const historyRef = useRef<Turn[]>([]);
  /**
   * Whether the microphone should re-open when she stops speaking.
   *
   * A ref rather than state because `play`'s `onended` fires from an audio
   * callback outside React's render cycle, and a stale `false` there is a
   * conversation that silently stops after one turn.
   */
  const conversingRef = useRef(false);
  /** Set when a turn is being abandoned, so `onstop` discards instead of sending. */
  const discardRef = useRef(false);
  /**
   * `start`, late-bound.
   *
   * `play` and `start` are mutually recursive — an answer opens the next turn,
   * and a turn produces the next answer — so one of them has to reach the other
   * through a ref. `play` is the one that fires from outside React, so it is the
   * one that indirects.
   */
  const startRef = useRef<((continued?: boolean) => Promise<void>) | null>(null);

  /**
   * The only way the card changes, so the ref cannot drift from what is on
   * screen.
   *
   * Two copies of one fact is a bug waiting to be written — dismissing the card
   * while still sending its pending action back would let a stray "כן" confirm
   * something the owner had already waved away. Funnelled through here so
   * there is one place to get it right, and `useCallback` with no dependencies
   * so it stays stable for the memoised recorder callbacks.
   */
  const showResult = useCallback((next: Result | null) => {
    pendingRef.current = next?.pending ?? null;
    setResult(next);
  }, []);

  /** The one writer of both copies of "is a conversation open". */
  const setConversing = useCallback((open: boolean) => {
    conversingRef.current = open;
    setConversingState(open);
  }, []);

  /**
   * Ends the conversation and forgets it.
   *
   * **The history goes with it, and that is the point rather than tidiness.**
   * A closed session's sentences are exactly the ones a later "תבטל אותו" must
   * not resolve against — the owner has moved on, possibly hours ago, and a
   * pronoun that reaches back across that gap is how the wrong appointment gets
   * cancelled. The server also expires them, at fifteen minutes; this is the
   * near end of the same rule.
   */
  const endConversation = useCallback(() => {
    setConversing(false);
    historyRef.current = [];
  }, [setConversing]);

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

  /**
   * **Unlocks audio output on the gesture that starts the recording.**
   *
   * The reply arrives six to nine seconds after the tap, and by then the tap is
   * long gone as far as an autoplay policy is concerned — which is why the
   * `<Audio>` element this replaces was intermittently refused, most often on
   * exactly the mobile browsers the feature exists for. An `AudioContext`
   * *resumed* inside a real gesture stays running for the life of the page, so
   * the unlock happens once, at the press, and every later reply plays through
   * it without asking again.
   *
   * Kept across turns and never closed: closing it would put the lock back and
   * the next answer would be silent.
   */
  const unlockAudio = useCallback((): AudioContext | null => {
    type WithWebkit = typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor =
      window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
    if (!Ctor) return null;

    audioCtxRef.current ??= new Ctor();
    // `resume()` is the part that must happen inside the gesture. It is safe to
    // call on an already-running context.
    if (audioCtxRef.current.state !== "running") {
      void audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  /** Plays one base64 mp3 through the unlocked context. */
  const play = useCallback(async (base64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // `decodeAudioData` wants its own ArrayBuffer and detaches what it is given.
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    /**
     * **The turn hands back to the microphone here, not at the answer.**
     *
     * Re-opening when the *text* arrives would have ליבי listening to herself:
     * the reply is on screen about three seconds before it finishes being
     * spoken, and the analyser would hear her own voice through the speaker,
     * latch, and cut the owner's turn short before they had said anything.
     * `onended` is the only moment the room is quiet again.
     *
     * `startRef` rather than `start` directly — the two callbacks are mutually
     * recursive (a turn starts a turn) and one of them has to be late-bound.
     */
    source.onended = () => {
      setPhase("idle");
      if (conversingRef.current) void startRef.current?.(true);
    };
    setPhase("speaking");
    source.start();
  }, []);

  /**
   * Stops the recording once the speaking stops.
   *
   * An `AnalyserNode` on the live stream, sampled per animation frame, reduced
   * to one RMS number. Two rules: the level has to cross {@link SPEECH_RMS} at
   * least once before anything can auto-stop — otherwise a quiet room ends the
   * recording before the owner has drawn breath — and after that, a continuous
   * {@link SILENCE_MS} below the line ends it.
   *
   * `requestAnimationFrame` rather than a timer: it is already the browser's
   * paint clock, it pauses with a backgrounded tab, and it gives roughly 60
   * samples a second, which is far finer than the 1.8s it is measuring.
   */
  const listenForSilence = useCallback(
    (
      ctx: AudioContext,
      stream: MediaStream,
      onSilent: () => void,
      /**
       * Called when nobody spoke at all. Only supplied for a turn the
       * microphone opened by itself — see {@link decideIdle}.
       */
      onIdle?: () => void,
    ) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      let state = INITIAL_SILENCE_STATE;
      let frame = 0;
      const openedAt = performance.now();

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        const now = performance.now();

        // The maths and the latch live in `libi-vad`, which is tested; this
        // loop only supplies frames and a clock.
        const outcome = decideSilence(state, frameLevel(samples), now);
        state = outcome.state;

        if (outcome.stop) {
          onSilent();
          return;
        }

        // Nobody spoke into a turn nobody asked for. Ends the conversation
        // rather than sending seven seconds of shop to Whisper.
        if (onIdle && decideIdle(state, now - openedAt)) {
          onIdle();
          return;
        }

        frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);

      return {
        stop: () => {
          cancelAnimationFrame(frame);
          source.disconnect();
          analyser.disconnect();
        },
      };
    },
    [],
  );

  /** Releases the microphone. The browser's recording indicator is a promise. */
  const releaseStream = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      analyserRef.current?.stop();
      // Navigating away ends the conversation; without this the ref would stay
      // true and a remount would re-open the microphone unasked.
      conversingRef.current = false;
      releaseStream();
    };
  }, [releaseStream]);

  const send = useCallback(
    async (audio: Blob) => {
      setPhase("processing");

      const form = new FormData();
      // The extension is decided server-side from the MIME type — Whisper
      // dispatches on the filename, and the container differs by browser.
      form.append("audio", audio, "speech");

      /**
       * What the previous turn asked about, so this one can be an answer to it.
       *
       * Read from the ref rather than from `result`, because `send` is a
       * `useCallback` the recorder holds across the whole turn: closing over
       * the state would send whatever was pending when the callback was built,
       * which is one turn stale exactly when it matters.
       */
      const carried = pendingRef.current;
      if (carried) form.append("pending", JSON.stringify(carried));

      // The exchange so far, for the same reason and by the same route.
      if (historyRef.current.length > 0) {
        form.append("history", JSON.stringify(historyRef.current));
      }

      try {
        const response = await fetch("/api/voice/process", {
          method: "POST",
          body: form,
        });

        /**
         * A refusal is one JSON object; a success is two lines of NDJSON. The
         * content type is what says which, so a 500 behind a proxy that
         * rewrote the body cannot be parsed as a stream that never came.
         */
        const isStream = response.headers
          .get("content-type")
          ?.includes("ndjson");

        if (!isStream || !response.body) {
          showResult((await response.json()) as Result);
          setPhase("idle");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        let spokeAloud = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });

          // A chunk boundary can land mid-line, so only whole lines are parsed.
          let newline = buffered.indexOf(NEWLINE);
          while (newline >= 0) {
            const line = buffered.slice(0, newline).trim();
            buffered = buffered.slice(newline + 1);
            newline = buffered.indexOf(NEWLINE);
            if (!line) continue;

            const message = JSON.parse(line) as
              | (Result & { type: "text" })
              | { type: "audio"; audioBase64: string | null };

            if (message.type === "text") {
              // The card, about two seconds before she can say it.
              showResult({ ...message, audioBase64: null });

              /**
               * Recorded as an exchange so the next turn can point at it.
               *
               * The *transcript* is stored rather than what was actually said
               * into the microphone, because that is what the model saw — if
               * Whisper heard "דנאי" then "אותו" has to resolve against
               * "דנאי", and storing the truth would leave the two out of step.
               */
              if (message.transcribedText && message.textResult) {
                historyRef.current = [
                  ...historyRef.current,
                  {
                    said: message.transcribedText,
                    replied: message.textResult,
                    at: Date.now(),
                  },
                ].slice(-MAX_CLIENT_TURNS);
              }
            } else if (message.audioBase64) {
              spokeAloud = true;
              await play(message.audioBase64).catch(() => setPhase("idle"));
            }
          }
        }

        // No audio line, or one that carried nothing: the answer is on screen
        // and there is nothing left to wait for.
        if (!spokeAloud) setPhase("idle");
      } catch {
        showResult({
          transcribedText: "",
          textResult: "לא הצלחתי להגיע לשרת. כדאי לנסות שוב.",
          audioBase64: null,
          actionTaken: "none",
          error: "network",
        });
        setPhase("idle");
      }
    },
    [play, showResult],
  );

  const stop = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    analyserRef.current?.stop();
    analyserRef.current = null;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  /**
   * Ends the conversation without sending what is in the buffer.
   *
   * Both ways out land here: the owner pressing סגור, and nobody speaking into
   * a microphone that opened by itself. The discard flag is set *before* the
   * recorder stops, because `onstop` is where the decision to send is made and
   * it fires on the next tick.
   */
  const closeQuietly = useCallback(() => {
    discardRef.current = true;
    endConversation();
    stop();
  }, [endConversation, stop]);

  /**
   * Opens the microphone.
   *
   * `continued` is true when the conversation re-opened it rather than the
   * owner. That changes three things and nothing else: the card is left alone,
   * the idle timeout is armed, and a conversation is already in progress so it
   * is not started again.
   */
  const start = useCallback(async (continued = false) => {
    if (phase !== "idle") return;

    /**
     * **Before anything async.** `resume()` only counts as user-activated while
     * the gesture is still live, and `await getUserMedia(...)` is long enough
     * to lose that. Unlocking first is the whole fix for replies that used to
     * arrive silently.
     */
    const audioCtx = unlockAudio();

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

        // Abandoned rather than finished: nobody spoke, or the owner closed
        // the conversation mid-turn. Either way there is nothing to send.
        if (discardRef.current) {
          discardRef.current = false;
          setPhase("idle");
          return;
        }

        // A tap that lands and lifts in the same instant produces a few bytes
        // of silence; sending it costs a model call to be told nothing.
        if (blob.size < 1024) {
          setPhase("idle");
          return;
        }
        void send(blob);
      };

      recorder.start();
      /**
       * The card is cleared on a *pressed* turn only.
       *
       * Mid-conversation her last answer is the thing the owner is reading
       * while deciding what to say next — and, when it carries a pending
       * change, the button they may be about to press instead of speaking.
       * Wiping it the instant the microphone re-opens takes both away.
       */
      if (!continued) showResult(null);
      setPhase("recording");

      /**
       * The cap is now a backstop rather than the way a turn normally ends.
       * Silence stops it after {@link SILENCE_MS}; twenty seconds is what
       * catches a pocket, a stuck threshold, or a browser with no AudioContext.
       */
      stopTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);
      if (audioCtx) {
        analyserRef.current = listenForSilence(
          audioCtx,
          stream,
          stop,
          /**
           * Armed only on a continued turn. A pressed one has no idle timeout
           * at all — the owner meant to speak, and closing the microphone on
           * somebody who is still thinking is the worst thing this can do.
           */
          continued ? closeQuietly : undefined,
        );
      }

      // A pressed turn is what opens a conversation; a continued one is
      // already inside it.
      if (!continued) setConversing(true);
    } catch {
      // Denied, or no device. Both are the owner's to fix and neither is worth
      // a thrown error in a dashboard.
      toast("אין גישה למיקרופון. אפשר לאשר בהגדרות הדפדפן.", "error");
      endConversation();
      setPhase("idle");
    }
  }, [
    phase,
    closeQuietly,
    endConversation,
    listenForSilence,
    releaseStream,
    send,
    setConversing,
    showResult,
    stop,
    toast,
    unlockAudio,
  ]);

  // Published for `play`'s `onended`, which cannot close over `start` itself.
  startRef.current = start;

  /**
   * The tap half of the confirmation, kept alongside the spoken one.
   *
   * ליבי asks out loud and "כן" answers her — but the owner is holding the
   * phone, the shop is loud, and a button that says what it will do is the
   * version that works when speaking twice has not. Both routes end at the same
   * two writes; this one goes through the dashboard's own server actions, which
   * carry `requireWritable`, rather than through the voice endpoint.
   */
  function confirmPending(pending: Pending) {
    startConfirm(async () => {
      const outcome =
        pending.kind === "cancel"
          ? await setAppointmentStatusAction(pending.appointmentId, "cancelled")
          : await rescheduleAppointmentAction({
              appointmentId: pending.appointmentId,
              date: pending.targetDate,
              time: pending.targetTime,
              /**
               * **The button is the confirmation, so it does not ask again.**
               *
               * `force` waives posted hours, breaks and notice periods — the
               * shop's own policy, which an owner squeezing somebody in is
               * entitled to overrule, and which `createManualBookingAction`
               * already skips outright. Sending `false` here would put an amber
               * modal behind a button the owner pressed *because* it named the
               * move, which is the double-ask that type's own comment calls
               * worse than a plain no.
               *
               * It waives nothing that matters: a same-provider clash is a
               * database constraint, comes back as an ordinary error, and is
               * surfaced in the toast below. The spoken path reaches the same
               * place through `executePending`, so the two agree.
               */
              force: true,
            });

      if (outcome.ok) {
        toast(
          pending.kind === "cancel"
            ? `${pending.clientName}: התור בוטל`
            : `${pending.clientName}: התור הוזז ל-${pending.toWhen}`,
        );
        showResult(null);
        router.refresh();
      } else {
        // `force: true` means the confirm branch cannot come back, but the
        // union still carries it — read the message either way rather than
        // asserting a shape the action is free to change.
        toast("error" in outcome ? outcome.error : outcome.message, "error");
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
          ? "ליבי מקשיבה"
          : phase === "processing"
            ? "ליבי מעבדת"
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
                  ליבי שמעה: &laquo;{result.transcribedText}&raquo;
                </p>
              ) : null}
              <p className="mt-1 text-sm leading-relaxed font-semibold text-zinc-900 dark:text-zinc-50">
                {result.textResult}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                closeQuietly();
                showResult(null);
              }}
              aria-label="סגירה"
              className="-me-1 shrink-0 rounded-lg p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* **The conversation's own state, said plainly.**

              A microphone that re-opened by itself is the one thing on this
              card the owner did not do, so it says so — and it says which of
              the two it is, because "she is listening" and "she is thinking"
              feel identical from three feet away and only one of them is a
              cue to start talking. `aria-live` because a blind user has no
              ring to watch. */}
          {conversing ? (
            <div
              className="mt-2.5 flex items-center justify-between gap-2"
              aria-live="polite"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                <span
                  className={cn(
                    "size-1.5 rounded-full bg-current",
                    phase === "recording" && "motion-safe:animate-pulse",
                  )}
                  aria-hidden
                />
                {phase === "recording"
                  ? "מקשיבה — אפשר לדבר"
                  : phase === "speaking"
                    ? "מדברת…"
                    : "רגע…"}
              </span>
              <button
                type="button"
                onClick={() => {
                  closeQuietly();
                  showResult(null);
                }}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                סגור
              </button>
            </div>
          ) : null}

          {/* The destructive write, and the only place one is confirmed by
              tapping. The name and both times are on the button, so the thing
              being confirmed is the thing being read — and the hint says the
              same answer can simply be spoken, since she has just asked. */}
          {result.pending ? (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => confirmPending(result.pending!)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-white transition-colors disabled:opacity-60",
                    result.pending.kind === "cancel"
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-violet-600 hover:bg-violet-700",
                  )}
                >
                  {confirming ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="size-3.5" aria-hidden />
                  )}
                  {result.pending.kind === "cancel"
                    ? `ביטול התור של ${result.pending.clientName} ב-${result.pending.when}`
                    : `הזזת ${result.pending.clientName} מ-${result.pending.when} ל-${result.pending.toWhen}`}
                </button>
                <button
                  type="button"
                  onClick={() => showResult(null)}
                  className="h-9 rounded-lg px-3 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  לא עכשיו
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                אפשר גם פשוט לענות לה &quot;כן&quot;.
              </p>
            </div>
          ) : null}

          {result.error && result.error !== "empty_transcript" ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {result.error === "not_configured"
                ? "ליבי לא מוגדרת בשרת."
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
            // Stopping by hand sends what was said; it does not close the
            // conversation, so her answer still hands back to the microphone.
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
        aria-label={phase === "recording" ? "עצירת ההקלטה" : "דיבור עם ליבי"}
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
