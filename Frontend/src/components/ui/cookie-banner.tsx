"use client";

import { useState } from "react";
import Link from "next/link";

import { useIsClient } from "@/lib/use-is-client";

const STORAGE_KEY = "bazman.cookie-consent";

function hasConsented(): boolean {
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode or storage disabled. Treated as consented so the banner is
    // not shown on every single page load with no way to dismiss it — the
    // worse of the two failures.
    return true;
  }
}

/**
 * First-visit consent notice.
 *
 * The choice is kept in `localStorage`, not a cookie. That is deliberate and
 * is the opposite of the rule applied to the session: this value is a UI
 * preference with no security meaning, and storing it client-side keeps it out
 * of every request header. The session token goes the other way — `httpOnly`
 * cookie, unreadable from script. Neither approach is right for both.
 *
 * Only ever renders after mount, because the server cannot know whether this
 * visitor has already accepted, and rendering it server-side would flash the
 * banner at everyone on every page load.
 *
 * The site uses strictly necessary cookies only, so this is a notice rather
 * than a gate: nothing is blocked pending consent, and there is no "reject"
 * because there is nothing optional to reject. A refuse button that switches
 * nothing off would be theatre.
 */
export function CookieBanner() {
  const isClient = useIsClient();
  const [dismissed, setDismissed] = useState(false);

  // Read during render rather than in an effect: the value is synchronous and
  // an effect would cost a second render pass on every mount.
  const visible = isClient && !dismissed && !hasConsented();

  function accept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignored: dismissing for this session is still better than nothing.
    }
    setDismissed(true);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="הודעת עוגיות"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:inset-x-6 dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          אנחנו משתמשים בעוגיות כדי לשפר את החוויה שלכם. בלחיצה על ״מאשר״ אתם
          מסכימים ל
          <Link
            href="/legal/privacy"
            className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            מדיניות הפרטיות
          </Link>{" "}
          ול
          <Link
            href="/legal/terms"
            className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            תנאי השימוש
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={accept}
          className="h-10 shrink-0 rounded-full bg-zinc-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          מאשר
        </button>
      </div>
    </div>
  );
}
