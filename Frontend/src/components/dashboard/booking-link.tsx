"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { bookingUrlFor, browserOrigin, pickAppUrl } from "@/lib/app-url";
import { cn } from "@/lib/utils";

/**
 * The shop's public link, with a copy button.
 *
 * ---------------------------------------------------------------------------
 * Extracted from the onboarding "done" step rather than written twice. The
 * settings page needed the same control, and the interesting parts of this are
 * the two that a second implementation would have quietly got wrong:
 *
 * **The origin.** The server already resolved `appUrl` from the request, so it
 * is normally right. `useSyncExternalStore` is the last line of defence for the
 * case that actually reached an owner — a deploy where the configured origin
 * still said localhost. It is built for exactly this shape: a value the server
 * cannot know, with an explicit server snapshot, so there is no hydration
 * mismatch and no setState in an effect.
 *
 * **The clipboard can refuse.** It is unavailable on insecure origins, so the
 * URL is always rendered as selectable text and the button is an accelerator,
 * never the only way to get the link.
 * ---------------------------------------------------------------------------
 */
export function BookingLink({
  appUrl,
  slug,
  className,
}: {
  /** Resolved server-side from the request. */
  appUrl: string;
  /**
   * The **saved** slug, never a value being edited.
   *
   * Copying a link built from an unsaved field would hand a client a URL that
   * 404s — the shop still lives at the old address until the form is submitted.
   */
  slug: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const origin = useSyncExternalStore(
    () => () => {},
    browserOrigin,
    () => null,
  );

  const liveUrl = bookingUrlFor(pickAppUrl(appUrl, origin), slug);

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
    <div className={className}>
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
          className={cn(
            "flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors",
            "border-zinc-300 text-zinc-800 hover:bg-zinc-50",
            "dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
          )}
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
          href={`/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <ExternalLink className="size-4" aria-hidden />
          תצוגה
        </a>
      </div>

      {/* Announced rather than only coloured — a screen reader gets the same
          confirmation the icon gives everyone else. */}
      <span aria-live="polite" className="sr-only">
        {copied ? "הקישור הועתק" : ""}
      </span>
    </div>
  );
}
