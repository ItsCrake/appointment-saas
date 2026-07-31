"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { createBusinessAction } from "@/app/dashboard/setup/actions";

export function SetupForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      // Redirects on success, so only failures return.
      const result = await createBusinessAction({ name, slug, phone });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          שם העסק
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="מספרת רון"
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-base focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          כתובת עמוד ההזמנות
        </span>
        <div className="flex items-center gap-1" dir="ltr">
          <span className="shrink-0 text-sm text-neutral-400">/</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ron-barber"
            className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-start text-base focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
          />
        </div>
        <span className="mt-1.5 block text-xs text-neutral-500">
          אותיות באנגלית, מספרים ומקפים בלבד
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          טלפון (לא חובה)
        </span>
        <input
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="050-1234567"
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-start text-base focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        יצירת העסק
      </button>
    </form>
  );
}
