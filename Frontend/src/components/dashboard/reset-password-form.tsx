"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { updatePasswordAction } from "@/app/login/actions";
import { FormAlert } from "@/components/ui/form-alert";
import { callAuthAction } from "@/lib/call-action";
import { cn } from "@/lib/utils";

import { PasswordRulesList } from "./password-rules-list";
import { btnPrimary, inputClass } from "./ui";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    // On success this redirects to /dashboard, so control does not return.
    const result = await callAuthAction(() =>
      updatePasswordAction(password, confirm),
    );

    setPending(false);
    if (!result.ok) setError(result.error);
  }

  const field = cn(inputClass, "h-12 px-4 text-base");

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="new-password"
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          סיסמה חדשה
        </label>
        <input
          id="new-password"
          type="password"
          dir="ltr"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <PasswordRulesList value={password} />
      </div>

      <div>
        <label
          htmlFor="confirm-password"
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          אימות סיסמה
        </label>
        <input
          id="confirm-password"
          type="password"
          dir="ltr"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={field}
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
          "שמירת הסיסמה החדשה"
        )}
      </button>

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        לאחר השמירה תנותקו מכל שאר המכשירים המחוברים לחשבון.
      </p>
    </form>
  );
}
