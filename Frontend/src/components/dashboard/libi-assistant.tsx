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
  swapAppointmentsAction,
} from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  AUDIO_CONSTRAINTS,
  MAX_CONTINUED_TURN_MS,
  MAX_PRESSED_TURN_MS,
  MAX_UNHEARD_TURNS,
  pickRecorderMimeType,
  RECORDER_BITS_PER_SECOND,
  RELEASE_TAIL_MS,
  ROOM_SEED_MAX_AGE_MS,
} from "@/lib/voice/libi-capture";
import { SPEECH_RATE, timeStretch } from "@/lib/voice/libi-stretch";
import {
  decideSilence,
  frameFeatures,
  IDLE_MS,
  idleOutcome,
  initialSilenceState,
  PRESSED_IDLE_MS,
  SHORT_SILENCE_MS,
  SILENCE_MS,
  type IdleOutcome,
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
 * wrong for one that opened by itself. `idleOutcome` closes the conversation
 * instead when nothing was heard, and sends the turn when something was.
 *
 * **The microphone stays open for the whole conversation.** It used to be
 * released after every recording and opened again for the next one, and the
 * owner's first syllable — the verb, the word that picks the tool — was spoken
 * into a device that was still starting. One stream now serves every turn and
 * is released when the conversation ends, the page is hidden, or the
 * component goes away.
 *
 * **Holding the button means the owner decides.** While it is held the
 * silence detector may not end the turn; letting go ends it half a second
 * later, because people let go on the last syllable.
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
    }
  | {
      kind: "swap";
      first: SwapLeg;
      second: SwapLeg;
    };

type SwapLeg = {
  appointmentId: string;
  clientName: string;
  when: string;
  toWhen: string;
  startsAtIso: string;
  targetStartsAtIso: string;
};

/**
 * A change she began and asked one more detail about — "איזה שירות?", "אצל
 * מי?", "לאיזו שעה להזיז?".
 *
 * Opaque here on purpose. The card has nothing to confirm — the answer is
 * spoken — so this side only holds it and sends it back with the next
 * recording, the way it holds a pending action. See `DraftAction`.
 */
type Draft = { kind: "book" | "move" } & Record<string, unknown>;

type Result = {
  transcribedText: string;
  textResult: string;
  audioBase64: string | null;
  actionTaken: string;
  pending?: Pending;
  draft?: Draft;
  /** A same-origin path she was asked to open — see `VoiceNavigation`. */
  navigate?: { href: string };
  /** The diary changed this turn — see `DiaryChange`. */
  changed?: { kind: string; appointmentIds: string[] };
  error?: string;
};

/**
 * How long her last answer stays on screen after the conversation ends.
 *
 * Long enough to finish reading a sentence that has just been spoken aloud —
 * four seconds is roughly twice the time it takes to read one — and short
 * enough that the card is gone before it becomes furniture. It is a receipt
 * for something the owner already heard, not a panel they have to dismiss.
 *
 * A pending change is exempt: that card is a *question*, and a question that
 * disappears while somebody is deciding is worse than one that lingers.
 */
const DISMISS_AFTER_MS = 4000;

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

/** The rate the speech arrives at — see `ELEVENLABS_OUTPUT_FORMAT`. */
const SPEECH_SAMPLE_RATE = 22_050;

/**
 * A clip of her voice as samples, at its own rate where the browser allows.
 *
 * An `OfflineAudioContext` decodes without resampling to the playback
 * context's 48kHz, which halves the work `faster` has to do; a browser without
 * one decodes the ordinary way. The bytes are copied for the first attempt,
 * because `decodeAudioData` detaches what it is given and the fallback needs
 * them whole.
 */
async function decodeSpeech(
  ctx: AudioContext,
  data: ArrayBuffer,
): Promise<AudioBuffer> {
  type WithWebkit = typeof window & {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Offline =
    window.OfflineAudioContext ??
    (window as WithWebkit).webkitOfflineAudioContext;
  if (Offline) {
    try {
      return await new Offline(1, 1, SPEECH_SAMPLE_RATE).decodeAudioData(
        data.slice(0),
      );
    } catch {
      // Fall through to the playback context.
    }
  }
  return ctx.decodeAudioData(data);
}

/** The clip, `SPEECH_RATE` times faster at the same pitch. */
function faster(ctx: AudioContext, decoded: AudioBuffer): AudioBuffer {
  if (SPEECH_RATE === 1) return decoded;
  const stretched = timeStretch(
    decoded.getChannelData(0),
    decoded.sampleRate,
    SPEECH_RATE,
  );
  const buffer = ctx.createBuffer(1, stretched.length, decoded.sampleRate);
  buffer.getChannelData(0).set(stretched);
  return buffer;
}

export function LibiAssistant() {
  const { toast } = useToast();
  const router = useRouter();

  const [phase, setPhaseState] = useState<Phase>("idle");
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
  /** Drives the fade; the card is removed when the timer lands. */
  const [dismissing, setDismissing] = useState(false);

  /**
   * The phase as it is *now*, not as it was when a callback was built.
   *
   * ---------------------------------------------------------------------
   * **This ref is the fix for a microphone that never reopened.** `play`'s
   * `onended` sets the phase to idle and then immediately asks `start` to
   * take the next turn — but `setPhase` is queued and the call is not, so
   * `start` ran inside a closure captured while the phase was still
   * `"speaking"`, hit its own `if (phase !== "idle") return`, and did
   * nothing. Every conversation stopped dead after ליבי's first answer,
   * silently, with the card still on screen saying she was listening.
   *
   * A ref updates synchronously, so the guard now reads the value the
   * line above it just wrote. It also takes `phase` out of `start`'s
   * dependencies, which is what made the closure stale to begin with.
   * ---------------------------------------------------------------------
   */
  const phaseRef = useRef<Phase>("idle");

  const recorderRef = useRef<MediaRecorder | null>(null);
  /**
   * The microphone, held for the whole conversation — see the header. Every
   * turn records from it; only the end of the conversation releases it.
   */
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The half-second after a manual stop, so the last syllable is kept. */
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the button is being held right now. While it is, the owner — not
   * the silence detector — decides when the turn ends.
   */
  const holdingRef = useRef(false);
  /**
   * The room the last turn measured, so the next one starts calibrated rather
   * than mistaking an owner who speaks at once for the background.
   */
  const roomRef = useRef<{ level: number; at: number } | null>(null);
  /** Turns in a row that came back with nothing heard — see `MAX_UNHEARD_TURNS`. */
  const unheardRef = useRef(0);
  /**
   * Which answer is current. Each request takes the next number; talking over
   * her moves it on, and a reading loop holding an older number stops.
   */
  const turnRef = useRef(0);
  /** The clip in the air, so talking over her can stop it. */
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
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
   * The half-finished change awaiting a detail, for the same reason and by the
   * same route as `pendingRef` — and written by the same one function.
   */
  const draftRef = useRef<Draft | null>(null);
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
  /** The pending fade-out of the card, so a new turn can cancel it. */
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  /**
   * Cancels a scheduled dismissal.
   *
   * Called wherever a card is written or a turn begins, because the one way
   * this feature goes wrong is a timer from the *previous* conversation
   * firing over the top of the current one and clearing an answer that is
   * two seconds old.
   */
  const cancelDismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setDismissing(false);
  }, []);

  const showResult = useCallback((next: Result | null) => {
    pendingRef.current = next?.pending ?? null;
    draftRef.current = next?.draft ?? null;
    // A card being written now is not a card being taken away.
    cancelDismiss();
    setResult(next);
  }, [cancelDismiss]);

  /** The one writer of both copies of the phase. */
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
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
  /** Releases the microphone. The browser's recording indicator is a promise. */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const endConversation = useCallback(() => {
    setConversing(false);
    historyRef.current = [];
    unheardRef.current = 0;
    // The conversation owned the microphone; nothing else may keep it.
    releaseStream();

    /**
     * **The card goes on its own once the conversation is over.**
     *
     * It is a receipt for something the owner has already heard, and leaving
     * it up turns it into furniture — a panel over the calendar that has to
     * be dismissed before the calendar can be used.
     *
     * **A pending change is exempt.** That card is a *question* with a button
     * on it, and a question that vanishes while somebody is deciding is worse
     * than one that lingers. So is a draft: "איזה שירות?" is a question the
     * owner answers by pressing the microphone again, and it has to still be
     * there — card and draft both — when they do. Read from the refs rather
     * than from `result`, which this callback cannot see.
     */
    if (pendingRef.current || draftRef.current) return;

    cancelDismiss();
    setDismissing(true);
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setDismissing(false);
      setResult(null);
      pendingRef.current = null;
      draftRef.current = null;
    }, DISMISS_AFTER_MS);
  }, [cancelDismiss, releaseStream, setConversing]);

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

  /**
   * Plays one piece of the reply, and resolves when it has finished.
   *
   * -------------------------------------------------------------------------
   * **Resolving on `onended` is what makes a queue possible.** A reply now
   * arrives as one to three clips — see `libi-chunks` — and they have to be
   * played in order, which means the caller needs to know when one is over.
   * This used to resolve at `source.start()`, so awaiting it meant nothing and
   * two clips would have played over each other.
   *
   * **What it deliberately no longer does is reopen the microphone.** That
   * belongs to the *last* clip, not to every clip, and only the loop reading
   * the stream knows which one that is.
   *
   * **A tenth faster, at the same pitch.** The clip is decoded at its own
   * 22kHz — cheaper to work on than the context's 48kHz — and time-stretched
   * before it plays, because the voice provider ignores its own speed setting.
   * See `libi-stretch`.
   *
   * **The source is kept** so the owner can talk over her: `interrupt` stops
   * it, and stopping fires `onended`, which is what lets the loop move on.
   * -------------------------------------------------------------------------
   */
  const play = useCallback(
    async (base64: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const decoded = await decodeSpeech(ctx, bytes.buffer);
      const buffer = faster(ctx, decoded);

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          if (sourceRef.current === source) sourceRef.current = null;
          resolve();
        };
        sourceRef.current = source;
        setPhase("speaking");
        source.start();
      });
    },
    [setPhase],
  );

  /**
   * Stops her mid-sentence so the owner can speak.
   *
   * The answer being spoken stops belonging to the current turn — the reading
   * loop sees the turn number move and drops the rest of the stream — and the
   * phase is idle again at once, so the press that interrupted can open the
   * microphone in the same gesture.
   */
  const interrupt = useCallback(() => {
    turnRef.current += 1;
    const source = sourceRef.current;
    sourceRef.current = null;
    try {
      source?.stop();
    } catch {
      // Already finished; nothing to stop.
    }
    setPhase("idle");
  }, [setPhase]);

  /**
   * Ends the recording once the speaking ends.
   *
   * An `AnalyserNode` on the live stream, sampled per animation frame as
   * float samples and reduced to two numbers — the speech band's level and how
   * voice-like its spectrum is. What those mean lives in `libi-vad`, which is
   * pure and calibrated against real commands under noise; this loop only
   * supplies frames and a clock.
   *
   * `requestAnimationFrame` rather than a timer: it is already the browser's
   * paint clock, it pauses with a backgrounded tab, and it gives roughly 60
   * samples a second, which is far finer than the 1.8s it is measuring.
   *
   * **A held button overrules it.** While the owner is holding, neither the
   * silence nor the idle rule may end the turn — letting go does.
   */
  const listenForSilence = useCallback(
    (
      ctx: AudioContext,
      stream: MediaStream,
      {
        onSilent,
        onIdle,
        idleMs,
        seed,
        expectsAnswer,
      }: {
        onSilent: () => void;
        /** Nobody audibly spoke within `idleMs` — see {@link idleOutcome}. */
        onIdle: (outcome: Exclude<IdleOutcome, "wait">) => void;
        idleMs: number;
        /** The room as the previous turn measured it, if recent. */
        seed?: number;
        /**
         * ליבי has just asked something, so a one-word reply is complete as
         * soon as it is said — see `SHORT_SILENCE_MS`.
         */
        expectsAnswer: boolean;
      },
    ) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      let state = initialSilenceState(seed);
      let frame = 0;
      const openedAt = performance.now();

      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        const now = performance.now();

        const outcome = decideSilence(
          state,
          frameFeatures(samples, ctx.sampleRate),
          now,
          SILENCE_MS,
          undefined,
          expectsAnswer ? SHORT_SILENCE_MS : undefined,
        );
        state = outcome.state;

        if (!holdingRef.current) {
          if (outcome.stop) {
            onSilent();
            return;
          }

          const idle = idleOutcome(state, now - openedAt, idleMs);
          if (idle !== "wait") {
            onIdle(idle);
            return;
          }
        }

        frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);

      return {
        stop: () => {
          cancelAnimationFrame(frame);
          source.disconnect();
          analyser.disconnect();
          // The next turn starts from the room this one measured.
          roomRef.current = { level: state.room, at: Date.now() };
        },
      };
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (tailTimerRef.current) clearTimeout(tailTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      analyserRef.current?.stop();
      // Navigating away ends the conversation; without this the ref would stay
      // true and a remount would re-open the microphone unasked.
      conversingRef.current = false;
      releaseStream();
    };
  }, [releaseStream]);

  /**
   * Hands the conversation back to the microphone — the one place a turn
   * starts another, and only while a conversation is open.
   *
   * `startRef` rather than `start`: a turn starts a turn, so one side of the
   * recursion has to be late-bound. And always `true`, because a continued
   * turn is armed differently from a pressed one — see `start`.
   */
  const continueConversation = useCallback(() => {
    if (conversingRef.current) void startRef.current?.(true);
  }, []);

  const send = useCallback(
    async (audio: Blob) => {
      const turn = ++turnRef.current;
      setPhase("processing");

      const form = new FormData();
      // The extension is decided server-side from the MIME type — the
      // transcription API dispatches on the filename, and the container
      // differs by browser.
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
      const unfinished = draftRef.current;
      if (unfinished) form.append("draft", JSON.stringify(unfinished));

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
          const refusal = (await response.json()) as Result;
          showResult(refusal);
          setPhase("idle");

          /**
           * **Nothing heard is a reason to listen again, not to stop.** The
           * transcriber returns an empty string for a word it could not make
           * out over the clippers, and any question it was answering is still
           * pending — the server hands it back. So the microphone re-opens and
           * the owner simply says it again, a bounded number of times in a
           * row. Anything else ends the conversation and frees the microphone.
           */
          if (
            refusal.error === "empty_transcript" &&
            conversingRef.current &&
            unheardRef.current < MAX_UNHEARD_TURNS
          ) {
            unheardRef.current += 1;
            continueConversation();
          } else {
            endConversation();
          }
          return;
        }

        unheardRef.current = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        let sawLast = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          // Talked over: the rest of this answer belongs to nobody.
          if (turn !== turnRef.current) {
            void reader.cancel().catch(() => {});
            return;
          }
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
              | { type: "audio"; audioBase64: string | null; last?: boolean };

            if (message.type === "text") {
              // The card, about two seconds before she can say it.
              showResult({ ...message, audioBase64: null });

              /**
               * Recorded as an exchange so the next turn can point at it.
               *
               * The *transcript* is stored rather than what was actually said
               * into the microphone, because that is what the model saw — if
               * the transcriber heard "דנאי" then "אותו" has to resolve against
               * "דנאי", and storing the truth would leave the two out of step.
               */
              /**
               * "תראי לי" means move the screen, and it moves *now* rather than
               * when she finishes speaking: the owner asked to look at
               * something, and three seconds of narration in front of it is
               * three seconds of not looking at it. The card and the audio
               * follow onto the calendar page, which is where they belong.
               */
              if (message.navigate?.href?.startsWith("/")) {
                router.push(message.navigate.href);
              }

              /**
               * **She wrote to the diary, so the calendar behind the card is
               * out of date.** It is rendered on the server and cannot see a
               * write it did not make, so a booking she took used to appear
               * only when the owner reloaded — at the one moment they were
               * looking to see whether she had understood. Refreshed now, on
               * the text line, so the card lands on the calendar as it is.
               *
               * `router.refresh()` re-renders the route's server components
               * and keeps every client component's state, this one included —
               * the conversation, the microphone and the clip in the air carry
               * on through it. A route handler cannot refresh the client the
               * way a server action does, so this side has to.
               */
              if (message.changed) router.refresh();

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
            } else {
              /**
               * One clip of the reply. They arrive in order and are played in
               * order — the next is already being generated while this one is
               * in the air, which is the whole point of asking for the answer
               * in pieces.
               */
              if (message.audioBase64) {
                await play(message.audioBase64).catch(() => {});
              }

              /**
               * **Talked over.** The owner pressed while she spoke: a new turn
               * owns the phase and the microphone now, so this one stops
               * reading and touches neither — writing "idle" or continuing
               * from here would land on top of the recording that replaced it.
               */
              if (turn !== turnRef.current) {
                void reader.cancel().catch(() => {});
                return;
              }

              /**
               * **The turn hands back to the microphone here**, on the last
               * clip and nowhere earlier. Reopening when the *text* arrived
               * would have ליבי listening to herself: the reply is on screen
               * seconds before it finishes being spoken, and the analyser
               * would hear her through the speaker, latch, and cut the owner
               * off before they had said anything.
               */
              if (message.last) {
                sawLast = true;
                setPhase("idle");
                continueConversation();
              }
            }
          }
        }

        /**
         * A stream that ended without its closing line — the server died
         * mid-answer. The answer on screen is all there is, and a conversation
         * with nothing to continue from must not keep the microphone.
         *
         * Only then: after `last` the phase may already belong to the *next*
         * turn, and writing "idle" over a live recording is how two recorders
         * end up running at once.
         */
        if (!sawLast) {
          setPhase("idle");
          endConversation();
        }
      } catch {
        showResult({
          transcribedText: "",
          textResult: "לא הצלחתי להגיע לשרת. כדאי לנסות שוב.",
          audioBase64: null,
          actionTaken: "none",
          error: "network",
        });
        setPhase("idle");
        endConversation();
      }
    },
    [continueConversation, endConversation, play, router, setPhase, showResult],
  );

  const stop = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tailTimerRef.current) {
      clearTimeout(tailTimerRef.current);
      tailTimerRef.current = null;
    }
    analyserRef.current?.stop();
    analyserRef.current = null;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  /**
   * Stops a turn the owner ended by hand — half a second from now.
   *
   * People let go of the button, or tap it, on the last syllable, and the last
   * syllable of a Hebrew command is the name or the time. The recorder keeps
   * that half second; a second call while it runs changes nothing.
   */
  const finishSoon = useCallback(() => {
    if (tailTimerRef.current) return;
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null;
      stop();
    }, RELEASE_TAIL_MS);
  }, [stop]);

  /**
   * Ends the conversation without sending what is in the buffer.
   *
   * Every way out lands here: the owner pressing סגור, nobody speaking into a
   * microphone that opened by itself, and the page being hidden. The discard
   * flag is set *before* the recorder stops, because `onstop` is where the
   * decision to send is made and it fires on the next tick — and the
   * microphone is released last, once nothing is recording from it.
   */
  const closeQuietly = useCallback(() => {
    // Only a live recording has anything to discard. Setting the flag with
    // nothing recording — closing while she speaks — used to leave it armed,
    // and the *next* question the owner asked was thrown away unheard.
    if (recorderRef.current?.state === "recording") discardRef.current = true;
    stop();
    endConversation();
  }, [endConversation, stop]);

  /**
   * The microphone, opened once per conversation.
   *
   * A live stream is reused as it is; one whose track has ended — a headset
   * unplugged, the permission revoked mid-conversation — is replaced.
   */
  const acquireStream = useCallback(async () => {
    const held = streamRef.current;
    if (held?.getAudioTracks().some((track) => track.readyState === "live")) {
      return held;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
    });
    streamRef.current = stream;
    return stream;
  }, []);

  /**
   * Opens a turn.
   *
   * `continued` is true when the conversation re-opened it rather than the
   * owner. That changes four things and nothing else: the card is left alone,
   * the idle window is the short one and may discard, the cap is lower, and a
   * conversation is already in progress so it is not started again.
   */
  const start = useCallback(async (continued = false) => {
    // `phaseRef`, never `phase` — see the ref's own note. Reading state
    // here is what stopped every conversation after one turn.
    if (phaseRef.current !== "idle") return;

    /**
     * **Before anything async.** `resume()` only counts as user-activated while
     * the gesture is still live, and `await getUserMedia(...)` is long enough
     * to lose that. Unlocking first is the whole fix for replies that used to
     * arrive silently.
     */
    const audioCtx = unlockAudio();

    try {
      const stream = await acquireStream();

      // The conversation was closed while the microphone was opening; the
      // stream that just opened belongs to nobody.
      if (continued && !conversingRef.current) {
        releaseStream();
        return;
      }

      const mimeType = pickRecorderMimeType(
        MediaRecorder.isTypeSupported?.bind(MediaRecorder),
      );
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORDER_BITS_PER_SECOND,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        if (recorderRef.current === recorder) recorderRef.current = null;

        // Abandoned rather than finished: nobody spoke, or the owner closed
        // the conversation mid-turn. Either way there is nothing to send.
        if (discardRef.current) {
          discardRef.current = false;
          setPhase("idle");
          return;
        }

        // A recording with nothing in it costs a model call to be told
        // nothing. The half-second tail makes this rare; it ends the
        // conversation rather than leaving the microphone held and idle.
        if (blob.size < 1024) {
          setPhase("idle");
          endConversation();
          return;
        }
        void send(blob);
      };

      // Whatever was fading is not fading any more: there is a turn now.
      cancelDismiss();
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
       * The cap is a backstop rather than the way a turn normally ends: the
       * silence detector ends it, or the owner does. It catches a pocket, a
       * radio the detector could not tell from a voice, and a browser with no
       * AudioContext.
       */
      stopTimerRef.current = setTimeout(
        stop,
        continued ? MAX_CONTINUED_TURN_MS : MAX_PRESSED_TURN_MS,
      );

      if (audioCtx) {
        const room = roomRef.current;
        analyserRef.current = listenForSilence(audioCtx, stream, {
          onSilent: stop,
          /**
           * **Who asked for the turn decides what silence means.** A pressed
           * turn waits longer and then *sends*: the owner meant to speak, and
           * a voice too buried to detect is still worth transcribing. A turn
           * that opened by itself discards when nothing at all happened — and
           * sends when something did.
           */
          onIdle: continued
            ? (outcome) => (outcome === "send" ? stop() : closeQuietly())
            : stop,
          idleMs: continued ? IDLE_MS : PRESSED_IDLE_MS,
          seed:
            room && Date.now() - room.at < ROOM_SEED_MAX_AGE_MS
              ? room.level
              : undefined,
          // A question is pending, or her last line was one: the answer is
          // likely a word, and a word is finished when it is said.
          expectsAnswer:
            continued &&
            (Boolean(pendingRef.current) ||
              Boolean(draftRef.current) ||
              /\?\s*$/.test(historyRef.current.at(-1)?.replied ?? "")),
        });
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
    acquireStream,
    cancelDismiss,
    closeQuietly,
    endConversation,
    listenForSilence,
    releaseStream,
    send,
    setConversing,
    setPhase,
    showResult,
    stop,
    toast,
    unlockAudio,
  ]);

  /**
   * A hidden page ends the conversation.
   *
   * The animation frame the detector runs on stops with a backgrounded tab,
   * so a turn left open would run to its cap unobserved — and a microphone
   * held behind a tab the owner cannot see is not one they agreed to.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && conversingRef.current) {
        closeQuietly();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [closeQuietly]);

  /**
   * Published for `play`'s `onended`, which cannot close over `start` itself.
   *
   * In an effect rather than during render: assigning a ref while rendering is
   * a side effect in a place React is allowed to run twice. Nothing can call
   * through this ref before the first playback, which is long after mount.
   */
  useEffect(() => {
    startRef.current = start;
  }, [start]);

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
        pending.kind === "swap"
          ? /**
             * The same re-check the spoken "כן" gets: the action re-reads
             * both bookings, re-plans the swap and refuses unless it lands
             * exactly where this button says. See `confirmSwap`.
             */
            await swapAppointmentsAction({
              first: pending.first,
              second: pending.second,
            })
          : pending.kind === "cancel"
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
          pending.kind === "swap"
            ? `${pending.first.clientName} ו${pending.second.clientName}: התורים הוחלפו`
            : pending.kind === "cancel"
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
            // z-[46]: above her own listening ring (45), beneath every modal
            // and toast (50). At 50 she painted over whichever sheet opened
            // after her, because an equal z-index falls back to DOM order.
            "animate-sheet fixed inset-x-3 z-[46] mx-auto max-w-lg rounded-2xl border p-4 shadow-lg backdrop-blur",
            "border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-900/95",
            /**
             * The fade out, once the conversation has ended and nothing is
             * waiting on an answer.
             *
             * Long, and deliberately so: a card that vanishes in 150ms reads as
             * a glitch, while one that takes most of a second reads as being
             * put away. `motion-safe` because a fade is decoration, and
             * somebody who has asked for less motion should simply get the card
             * until the timer removes it.
             */
            "motion-safe:transition-opacity motion-safe:duration-700",
            dismissing && "motion-safe:opacity-0",
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
                    ? "מדברת — אפשר לקטוע"
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
                  {result.pending.kind === "swap"
                    ? `החלפה: ${result.pending.first.clientName} ל-${result.pending.first.toWhen}, ${result.pending.second.clientName} ל-${result.pending.second.toWhen}`
                    : result.pending.kind === "cancel"
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

          {/* A detail she is waiting for. Nothing to tap — the answer is a
              word, and the card only says where it goes. */}
          {result.draft && !conversing ? (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              אפשר ללחוץ על המיקרופון ולענות לה.
            </p>
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
        onPointerDown={(event) => {
          // Pressing while she speaks is talking over her: she stops, and the
          // same press opens the microphone.
          if (phaseRef.current === "speaking") interrupt();
          if (phaseRef.current === "recording") {
            // Stopping by hand sends what was said; it does not close the
            // conversation, so her answer still hands back to the microphone.
            finishSoon();
            return;
          }
          pressedAtRef.current = Date.now();
          holdingRef.current = true;
          // The release must reach this button even if the finger slides off
          // it, or a hold would silently become a tap.
          event.currentTarget.setPointerCapture(event.pointerId);
          void start();
        }}
        onPointerUp={() => {
          const wasHolding = holdingRef.current;
          holdingRef.current = false;
          const held = Date.now() - pressedAtRef.current;
          if (wasHolding && phaseRef.current === "recording" && held > TAP_MS) {
            finishSoon();
          }
        }}
        onPointerCancel={() => {
          // The browser took the gesture (a scroll, a system sheet). The
          // detector gets the turn back rather than it being held forever.
          holdingRef.current = false;
        }}
        /**
         * Keyboard only. A pointer-driven click reports `detail >= 1`; Enter
         * and Space on a focused button report `0`, and that is the one case
         * the handlers above never see.
         */
        onClick={(event) => {
          if (event.detail !== 0) return;
          if (phaseRef.current === "speaking") interrupt();
          if (phaseRef.current === "recording") finishSoon();
          else void start();
        }}
        /**
         * **Only while she is thinking.** Speaking used to disable the button
         * too, so a reply the owner had already understood still had to be
         * sat through before the next question. Now a press stops her.
         */
        disabled={phase === "processing"}
        aria-label={phase === "recording" ? "עצירת ההקלטה" : "דיבור עם ליבי"}
        aria-pressed={phase === "recording"}
        className={cn(
          /**
           * **Beneath modals, not beside them.** At `z-50` — the z-index every
           * dashboard sheet also uses — the microphone won on DOM order and sat
           * on top of the appointment sheet on a phone, over its tabs, where a
           * modal is supposed to have the screen to itself. The stack is: bottom
           * nav 20, cookie banner 40, her ring 45, her controls 46, modals and
           * toasts 50.
           */
          "fixed end-4 z-[46] flex size-14 items-center justify-center rounded-full text-white shadow-lg transition-transform",
          "bottom-[calc(5rem_+_env(safe-area-inset-bottom))] md:bottom-8",
          "focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-zinc-100",
          "disabled:opacity-70 motion-safe:active:scale-95",
          phase === "recording"
            ? "bg-red-600"
            : "bg-[image:var(--brand-gradient)]",
        )}
      >
        {phase === "processing" ? (
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
