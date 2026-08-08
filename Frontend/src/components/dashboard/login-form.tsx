"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { signInAction, signUpAction } from "@/app/login/actions";
import { ConsentNote } from "@/components/ui/consent-note";
import { callAuthAction } from "@/lib/call-action";
import { FormAlert } from "@/components/ui/form-alert";
import { cn } from "@/lib/utils";

import { authLinkClass } from "./auth-shell";
import { PasswordRulesList } from "./password-rules-list";
import { btnPrimary, inputClass } from "./ui";

type Mode = "signin" | "signup";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setNotice(undefined);

    // On success these redirect, so control does not return here.
    const result = await callAuthAction(() =>
      mode === "signin"
        ? signInAction(email, password, next)
        : signUpAction(email, password),
    );

    setPending(false);
    if (!result.ok) setError(result.error);
    else if (result.message) setNotice(result.message);
  }

  const field = cn(inputClass, "h-12 px-4 text-base");

  return (
    <div>
      <div
        role="tablist"
        aria-label="מצב כניסה"
        className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {(
          [
            ["signin", "התחברות"],
            ["signup", "הרשמה"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(undefined);
              setNotice(undefined);
            }}
            className={cn(
              "h-9 rounded-lg text-sm font-semibold transition-colors",
              "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
              mode === value
                ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            אימייל
          </label>
          <input
            id="email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              סיסמה
            </label>
            {/* Sign-in only. Offering "forgot password" beside a field someone
                is *choosing* reads as an instruction to abandon the form. */}
            {mode === "signin" ? (
              <Link
                href="/login/forgot"
                className={cn(authLinkClass, "text-xs")}
              >
                שכחתם סיסמה?
              </Link>
            ) : null}
          </div>
          <input
            id="password"
            type="password"
            dir="ltr"
            required
            minLength={8}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          {/* The rules are rendered from the same constant the server
              validates against, and tick live, so the reader is never told
              "invalid password" without being shown which rule failed. */}
          {mode === "signup" ? <PasswordRulesList value={password} /> : null}
        </div>

        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

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
          ) : mode === "signin" ? (
            "התחברות"
          ) : (
            "יצירת חשבון"
          )}
        </button>

        <ConsentNote
          action={mode === "signin" ? "התחברות" : "הרשמה"}
          className="text-center"
        />
      </form>
    </div>
  );
}
