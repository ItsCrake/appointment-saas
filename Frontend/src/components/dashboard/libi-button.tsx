"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertCircle, Check, Loader2, Mic, X } from "lucide-react";

import { createManualBookingAction } from "@/app/dashboard/actions";
import { parseVoiceAppointment } from "@/app/dashboard/voice-actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  EMPTY_DRAFT,
  splitLocal,
  type LibiDraft,
} from "@/lib/voice/libi-schema";

/**
 * "ליבי" — book by speaking Hebrew.
 *
 * ---------------------------------------------------------------------------
 * Speech recognition is the browser's own (`webkitSpeechRecognition`), locked
 * to `he-IL`. That choice is worth stating because it is the whole reason this
 * feature is cheap: no audio ever leaves for a transcription service, there is
 * no per-minute cost, and the only thing that reaches our server is a short
 * string. What it costs instead is **support** — the API is Chromium-and-Safari
 * only, so Firefox users get told plainly rather than shown a dead button.
 *
 * The flow is multi-turn on purpose. A spoken booking almost never contains a
 * phone number, so Libi keeps a draft, asks in Hebrew for the first missing
 * field, and listens again. The draft lives here, in component state, and
 * travels to the server on each turn — the server holds no conversation.
 * ---------------------------------------------------------------------------
 */

type Phase =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "thinking" }
  /** Libi needs another utterance; `message` is her question. */
  | { kind: "asking"; message: string }
  | { kind: "booking"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

/**
 * Minimal shape of the Web Speech API.
 *
 * Hand-written because `lib.dom` does not ship these types — the API has never
 * left prefixed/experimental status. Only the members actually used are
 * declared; a fuller definition would be inventing a contract we do not test.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Whether this browser can do speech recognition at all.
 *
 * `useSyncExternalStore` rather than an effect: capability is external state
 * that React does not own, and this is the shape React documents for exactly
 * that. It also gets the server right — `getServerSnapshot` reports `true`, so
 * the markup rendered on the server matches the first client render and
 * Firefox simply drops the button on the following one, with no hydration
 * mismatch and no flash of a control that was never going to work.
 *
 * The subscribe function is a no-op because the answer cannot change: a browser
 * does not grow a speech API mid-session.
 */
const subscribeNever = () => () => {};

function useSpeechSupported(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => recognitionCtor() !== null,
    () => true,
  );
}

/** Hebrew for the error codes the spec actually defines. */
const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "אין הרשאה למיקרופון. יש לאשר גישה בהגדרות הדפדפן.",
  "service-not-allowed": "אין הרשאה למיקרופון. יש לאשר גישה בהגדרות הדפדפן.",
  "no-speech": "לא נקלט דיבור. נסו שוב.",
  "audio-capture": "לא נמצא מיקרופון במכשיר.",
  network: "אין חיבור לשירות הזיהוי הקולי.",
  aborted: "ההקלטה בוטלה.",
};

type ServiceOption = { id: string; name: string; durationMin: number };

export function LibiButton({
  services,
  onBooked,
}: {
  services: ServiceOption[];
  /** Refresh belongs to the parent — see ManualBookingDialog for the same note. */
  onBooked: () => void;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const supported = useSpeechSupported();
  const draftRef = useRef<LibiDraft>(EMPTY_DRAFT);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // A live recognition session holds the microphone. Unmounting mid-listen
  // without this leaves the browser's recording indicator on.
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  const book = useCallback(
    async (draft: LibiDraft, message: string) => {
      setPhase({ kind: "booking", message });

      const { date, time } = splitLocal(draft.startLocal!);
      const result = await createManualBookingAction({
        serviceId: draft.serviceId!,
        date,
        time,
        clientName: draft.clientName!,
        clientPhone: draft.clientPhone!,
        clientEmail: "",
        notes: draft.notes ?? "",
      });

      draftRef.current = EMPTY_DRAFT;

      if (!result.ok) {
        setPhase({ kind: "error", message: result.error });
        return;
      }

      // Same warning the manual dialog surfaces: a booking with no email queues
      // no client confirmation, and saying so is the whole point of it existing.
      if (result.warning) toast(result.warning, "error");
      setPhase({ kind: "done", message });
      onBooked();
    },
    [onBooked, toast],
  );

  const handleTranscript = useCallback(
    async (transcript: string) => {
      setPhase({ kind: "thinking" });

      const result = await parseVoiceAppointment({
        transcript,
        draft: draftRef.current,
      });

      if (!result.ok) {
        draftRef.current = EMPTY_DRAFT;
        setPhase({ kind: "error", message: result.error });
        return;
      }

      draftRef.current = result.draft;

      if (result.complete) {
        await book(result.draft, result.message);
        return;
      }

      // Libi asks, and waits for the owner to press again. Auto-restarting the
      // microphone here was rejected: an assistant that reopens the mic on its
      // own is listening to a room the owner did not agree to have listened to,
      // and in a shop that room has clients in it.
      setPhase({ kind: "asking", message: result.message });
    },
    [book],
  );

  const listen = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      // Unreachable in practice — the button is not rendered without support —
      // but a thrown TypeError here would surface as a blank dashboard.
      setPhase({ kind: "error", message: "הדפדפן אינו תומך בזיהוי דיבור." });
      return;
    }

    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = "he-IL";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let got = "";

    recognition.onresult = (event) => {
      got = event.results[0]?.[0]?.transcript?.trim() ?? "";
    };

    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setPhase({
        kind: "error",
        message:
          RECOGNITION_ERRORS[event.error] ?? "אירעה שגיאה בזיהוי הדיבור.",
      });
    };

    // `onend` fires after `onerror` too, so the transcript check is what
    // distinguishes "finished with something" from "already failed".
    recognition.onend = () => {
      recognitionRef.current = null;
      if (got) void handleTranscript(got);
      else
        setPhase((current) =>
          current.kind === "listening"
            ? { kind: "error", message: RECOGNITION_ERRORS["no-speech"] }
            : current,
        );
    };

    setPhase({ kind: "listening" });
    recognition.start();
  }, [handleTranscript]);

  function reset() {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    draftRef.current = EMPTY_DRAFT;
    setPhase({ kind: "idle" });
  }

  if (!supported || services.length === 0) return null;

  const busy = phase.kind === "thinking" || phase.kind === "booking";
  const listening = phase.kind === "listening";

  return (
    <>
      <button
        type="button"
        onClick={listening ? () => recognitionRef.current?.stop() : listen}
        disabled={busy}
        aria-label={listening ? "עצירת ההקלטה" : "הוספת תור בדיבור"}
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center rounded-full",
          "ring-1 transition-[background-color,box-shadow,color] duration-200 ring-inset",
          "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none",
          "active:scale-95 disabled:opacity-60",
          listening
            ? "bg-rose-600 text-white ring-rose-600"
            : "shadow-lift bg-white text-zinc-700 ring-zinc-900/8 hover:ring-zinc-900/20 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10",
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <Mic className="size-5" aria-hidden />
        )}
        {/* The pulse is the recording state, and it is a ring rather than a
            colour change alone so it survives a greyscale or high-contrast
            display. `aria-hidden` because the label above already says it. */}
        {listening ? (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full bg-rose-500/40"
          />
        ) : null}
      </button>

      {phase.kind !== "idle" ? (
        <LibiStatus phase={phase} onDismiss={reset} onRetry={listen} />
      ) : null}
    </>
  );
}

/**
 * The floating status card.
 *
 * `role="status"` with `aria-live="polite"`: Libi's replies are announced, but
 * they never interrupt — an owner mid-sentence with a client should not have a
 * screen reader talk over them.
 */
function LibiStatus({
  phase,
  onDismiss,
  onRetry,
}: {
  /**
   * `idle` is excluded rather than guarded inside: the card is only rendered
   * when there is something to say, and stating that in the type is what lets
   * the `phase.message` read below narrow without a runtime check that could
   * never fire.
   */
  phase: Exclude<Phase, { kind: "idle" }>;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const text =
    phase.kind === "listening"
      ? "ליבי מקשיבה…"
      : phase.kind === "thinking"
        ? "מעבדת…"
        : phase.kind === "booking"
          ? "קובעת את התור…"
          : phase.message;

  const tone =
    phase.kind === "error"
      ? "ring-red-600/20 bg-red-50 dark:bg-red-950/40"
      : phase.kind === "done"
        ? "ring-emerald-600/20 bg-emerald-50 dark:bg-emerald-950/40"
        : "ring-zinc-900/8 bg-white dark:bg-zinc-900 dark:ring-white/10";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "shadow-float fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl px-4 py-3.5 ring-1 ring-inset md:bottom-8",
        tone,
      )}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {phase.kind === "error" ? (
          <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
        ) : phase.kind === "done" ? (
          <Check className="size-5 text-emerald-600 dark:text-emerald-400" />
        ) : phase.kind === "listening" ? (
          <Mic className="size-5 animate-pulse text-rose-600" />
        ) : (
          <Loader2 className="size-5 animate-spin text-zinc-500" />
        )}
      </span>

      <p className="flex-1 text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
        {text}
      </p>

      {/* "אפשר לדבר" reopens the microphone for the next turn — the owner's
          press, never Libi's decision. */}
      {phase.kind === "asking" ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          לדבר
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="סגירה"
        className="-me-1 shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
