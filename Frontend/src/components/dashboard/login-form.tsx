"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { signInAction, signUpAction } from "@/app/login/actions";
import { cn } from "@/lib/utils";

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
    const result =
      mode === "signin"
        ? await signInAction(email, password, next)
        : await signUpAction(email, password);

    setPending(false);
    if (!result.ok) setError(result.error);
    else if (result.message) setNotice(result.message);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="מצב כניסה"
        className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800"
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
              mode === value
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
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
            className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
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
            className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-start text-base text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            סיסמה
          </label>
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
            className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-start text-base text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {mode === "signup" ? (
            <p className="mt-1.5 text-xs text-neutral-500">לפחות 8 תווים</p>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
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
      </form>
    </div>
  );
}
