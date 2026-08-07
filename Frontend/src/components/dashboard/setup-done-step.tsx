"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, PartyPopper } from "lucide-react";

import { bookingUrlFor, browserOrigin, pickAppUrl } from "@/lib/app-url";
import { formatDuration, formatPrice } from "@/lib/format";

import type { SetupBusiness } from "./setup-flow";

export function SetupDoneStep({
  business,
  services,
  appUrl,
  pending,
  onFinish,
}: {
  business: SetupBusiness;
  services: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
  }[];
  appUrl: string;
  pending: boolean;
  onFinish: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // The server already resolved this from the request, so `appUrl` is normally
  // right. This is the last line of defence for the case that actually reached
  // an owner: a deploy where the origin still resolved to localhost.
  //
  // `useSyncExternalStore` rather than an effect: it is built for exactly this
  // shape — a value the server cannot know, with an explicit server snapshot —
  // so there is no hydration mismatch and no setState inside an effect.
  const origin = useSyncExternalStore(
    () => () => {},
    browserOrigin,
    () => null,
  );

  const liveUrl = bookingUrlFor(pickAppUrl(appUrl, origin), business.slug);

  async function copy() {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins; the link is selectable.
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
        <div
          aria-hidden
          className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white"
        >
          <PartyPopper className="size-6" />
        </div>
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">
          {business.name} מוכן לקבל תורים
        </p>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
          שתפו את הקישור הזה עם הלקוחות שלכם
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p
          dir="ltr"
          className="mb-3 truncate rounded-lg bg-zinc-50 px-3 py-2.5 text-start text-sm font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {liveUrl}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {copied ? (
              <>
                <Check className="size-4 text-emerald-600" aria-hidden />
                הועתק
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden />
                העתקת הקישור
              </>
            )}
          </button>
          <a
            href={`/${business.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ExternalLink className="size-4" aria-hidden />
            תצוגה
          </a>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {services.map((service) => (
          <li
            key={service.id}
            className="flex items-center justify-between gap-3 text-zinc-700 dark:text-zinc-300"
          >
            <span className="truncate">{service.name}</span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
              {formatDuration(service.durationMin)} ·{" "}
              {formatPrice(service.priceCents)}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onFinish}
        disabled={pending}
        className="mt-5 h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60"
      >
        כניסה ללוח הניהול
      </button>
    </div>
  );
}
