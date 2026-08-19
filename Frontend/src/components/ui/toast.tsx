"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastTone = "success" | "error";

/**
 * An offer to take the message back.
 *
 * The label is spelled out per call rather than assumed, because "undo" is not
 * the only useful second chance a toast can carry — but the timing is shared:
 * see `UNDO_DURATION_MS`.
 */
export type ToastAction = {
  label: string;
  onAct: () => void;
};

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
};

export type ToastOptions = {
  tone?: ToastTone;
  action?: ToastAction;
  /** Defaults to `DURATION_MS`, or `UNDO_DURATION_MS` when there is an action. */
  durationMs?: number;
};

type ToastContextValue = {
  toast: (message: string, options?: ToastTone | ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

const DURATION_MS = 4000;

/**
 * Longer, because an undo has to be *read* before it can be taken.
 *
 * Four seconds is enough to notice that something happened; it is not enough to
 * register that the wrong appointment was cancelled, find the button and hit it
 * on a phone. Six is the figure the request named and it matches what the rest
 * of the industry settled on for the same reason.
 */
const UNDO_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * `toast("saved")`, `toast("failed", "error")` and
   * `toast("cancelled", { action })` all work — the second argument accepts the
   * old bare tone so that every existing call site keeps reading the way it did.
   */
  const toast = useCallback(
    (message: string, options: ToastTone | ToastOptions = "success") => {
      const resolved: ToastOptions =
        typeof options === "string" ? { tone: options } : options;
      const id = nextId.current++;

      setToasts((prev) => [
        ...prev,
        {
          id,
          message,
          tone: resolved.tone ?? "success",
          action: resolved.action,
          durationMs:
            resolved.durationMs ??
            (resolved.action ? UNDO_DURATION_MS : DURATION_MS),
        },
      ]);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // aria-live so screen readers announce actions that have no visual focus.
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={cn(
        "animate-step pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
        toast.tone === "success"
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-red-600 text-white",
      )}
    >
      {toast.tone === "success" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span className="flex-1">{toast.message}</span>

      {/* Ahead of the close button, so the useful control is the one nearer the
          thumb — and underlined rather than boxed, because a filled button on a
          filled toast is two competing surfaces at the size of a fingertip. */}
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAct();
            onDismiss(toast.id);
          }}
          className="shrink-0 font-bold underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100"
        >
          {toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="סגירה"
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
