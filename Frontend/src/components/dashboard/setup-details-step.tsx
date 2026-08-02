"use client";

import { useState } from "react";

import type { SetupBusiness } from "./setup-flow";

const FIELD =
  "h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 text-base text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-teal-700 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100";

/** Turns "מספרת רון" into a usable latin slug suggestion, or nothing. */
function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export function SetupDetailsStep({
  business,
  pending,
  onSubmit,
}: {
  business: SetupBusiness | null;
  pending: boolean;
  onSubmit: (values: { name: string; slug: string; phone: string }) => void;
}) {
  const [name, setName] = useState(business?.name ?? "");
  const [slug, setSlug] = useState(business?.slug ?? "");
  const [phone, setPhone] = useState(business?.phone ?? "");
  // Stop auto-filling the slug once the owner edits it themselves.
  const [slugTouched, setSlugTouched] = useState(Boolean(business?.slug));

  function handleName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(suggestSlug(value));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name, slug, phone });
      }}
      noValidate
      className="space-y-4"
    >
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          שם העסק
        </span>
        <input
          value={name}
          onChange={(e) => handleName(e.target.value)}
          placeholder="מספרת רון"
          className={FIELD}
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
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="ron-barber"
            className={`${FIELD} text-start`}
          />
        </div>
        <span className="mt-1.5 block text-xs text-neutral-500">
          אותיות באנגלית, מספרים ומקפים בלבד. זה הקישור שתשתפו עם לקוחות.
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
          className={`${FIELD} text-start`}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60"
      >
        המשך לשירותים
      </button>
    </form>
  );
}
