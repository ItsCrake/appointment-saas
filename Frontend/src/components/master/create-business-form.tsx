"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Plus } from "lucide-react";

import { createBusinessForOwnerAction } from "@/app/master/actions";

const FIELD =
  "h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-transparent focus:ring-2 focus:ring-white focus:outline-none";

/** "מספרת בלאק" → "" — a Hebrew name yields no latin slug, so the field stays
 *  the operator's to fill rather than being half-guessed at. */
function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

/**
 * Setting a pilot shop up before its owner has an account (0028).
 *
 * ---------------------------------------------------------------------------
 * **No password, no invitation email, no user created.** The operator names the
 * shop and the address that will run it; the binding completes the first time
 * that person signs in by any route the product already has. Anything else
 * would be a second way to become authenticated, and one is enough to get
 * right.
 *
 * The success message says what will happen rather than claiming it has —
 * nothing has reached the owner at this point, and the operator still has to
 * tell them to sign up. Saying "invitation sent" would be the product's oldest
 * rule broken in a toast.
 * ---------------------------------------------------------------------------
 */
export function CreateBusinessForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setOwnerEmail("");
    setPhone("");
  }

  function submit() {
    setError(undefined);
    setNotice(undefined);

    startTransition(async () => {
      const result = await createBusinessForOwnerAction({
        name,
        slug,
        ownerEmail,
        phone,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNotice(result.message ?? "נוצר");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-zinc-900 transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" aria-hidden />
          עסק חדש
        </button>

        {notice ? (
          <p className="mt-2 flex items-start gap-2 text-xs text-emerald-400">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
      className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">
        יצירת עסק לבעלים
      </h2>

      {error ? (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-300"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">שם העסק</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(suggestSlug(e.target.value));
            }}
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">
            כתובת הדף (slug)
          </span>
          <input
            dir="ltr"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={`${FIELD} text-start`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">
            אימייל הבעלים
          </span>
          <input
            type="email"
            dir="ltr"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
            className={`${FIELD} text-start`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">
            טלפון (לא חובה)
          </span>
          <input
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`${FIELD} text-start`}
          />
        </label>
      </div>

      {/* Said plainly, because the operator is about to tell a real person what
          to do next and the honest answer is "sign up, and it will be there". */}
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        לא נשלח אימייל ולא נוצר משתמש. העסק ישויך לכתובת הזו אוטומטית בפעם
        הראשונה שהבעלים יתחבר — בהרשמה רגילה או דרך איפוס סיסמה.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-zinc-900 disabled:opacity-60"
        >
          {pending ? "יוצר…" : "יצירה"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(undefined);
          }}
          disabled={pending}
          className="h-10 rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-300 disabled:opacity-60"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
