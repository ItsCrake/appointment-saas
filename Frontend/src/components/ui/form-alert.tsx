import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * The inline error / success block a form shows after a submit.
 *
 * `role` differs by tone on purpose: an error is `alert`, which a screen reader
 * interrupts for, while a confirmation is `status`, which it announces politely.
 * Announcing "we sent you an email" as an interruption is the kind of detail
 * that gets copied wrong once the same markup exists in three files.
 */
export function FormAlert({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  const error = tone === "error";
  const Icon = error ? AlertCircle : CheckCircle2;

  return (
    <p
      role={error ? "alert" : "status"}
      className={
        error
          ? "flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : "flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}
