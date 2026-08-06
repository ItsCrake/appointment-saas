"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Submit button for a plain `<form action={serverAction}>`.
 *
 * `useFormStatus` reads the pending state of the form it sits inside, which is
 * why this has to be a separate component rather than a prop on the form: the
 * hook returns `{ pending: false }` when called from the component that renders
 * the `<form>` itself.
 *
 * Disabling on submit is not only feedback. A form action posted twice runs
 * twice, and "nothing happened so I clicked again" is exactly how alpha
 * testers described this.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  /** Optional replacement copy while in flight. */
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-opacity disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
