"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { requestPasswordResetAction } from "@/app/login/actions";
import { FormAlert } from "@/components/ui/form-alert";
import { callAuthAction } from "@/lib/call-action";
import { cn } from "@/lib/utils";

import { authLinkClass } from "./auth-shell";
import { btnPrimary, inputClass } from "./ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setNotice(undefined);

    const result = await callAuthAction(() =>
      requestPasswordResetAction(email),
    );

    setPending(false);
    if (!result.ok) setError(result.error);
    else setNotice(result.message);
  }

  // Once the notice is up the form is replaced rather than left submittable.
  // Leaving the button live invites the "nothing happened, click again"
  // behaviour that burns the three-per-hour budget on a single sitting.
  if (notice) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{notice}</FormAlert>
        <p className="text-center text-xs leading-relaxed text-zinc-500">
          לא הגיע כלום?{" "}
          <button
            type="button"
            onClick={() => {
              setNotice(undefined);
              setError(undefined);
            }}
            className={authLinkClass}
          >
            נסו כתובת אחרת
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="reset-email"
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          אימייל
        </label>
        <input
          id="reset-email"
          type="email"
          dir="ltr"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(inputClass, "h-12 px-4 text-base")}
        />
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <button
        type="submit"
        disabled={pending}
        className={cn(btnPrimary, "h-12 w-full")}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            רגע…
          </>
        ) : (
          "שליחת קישור לאיפוס"
        )}
      </button>

      <p className="text-center text-xs text-zinc-500">
        נזכרתם?{" "}
        <Link href="/login" className={authLinkClass}>
          חזרה להתחברות
        </Link>
      </p>
    </form>
  );
}
