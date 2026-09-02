"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mic,
  Unplug,
} from "lucide-react";

import {
  generateSiriTokenAction,
  revokeSiriTokenAction,
} from "@/app/dashboard/settings/siri-actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { btnPrimary, btnSecondary, cardClass } from "./ui";

/**
 * The Siri panel: mint a key, read it, and learn what to do with it.
 *
 * ---------------------------------------------------------------------------
 * **There is no `.shortcut` file to download, and pretending otherwise would
 * be the worst thing this panel could do.** An Apple Shortcut is a signed
 * archive; since iOS 15 an unsigned one will not import unless the owner has
 * already gone into Settings and allowed untrusted shortcuts — and a button
 * labelled "download" that lands on a scary system warning, or on nothing, is
 * a support ticket dressed as a feature.
 *
 * So the button does the part that actually works: it copies the finished URL,
 * with the key already in it, ready to paste into one "Get contents of URL"
 * action. Four steps, stated plainly, and the owner ends up with a Shortcut
 * they can rename to whatever they want to say to Siri.
 *
 * `SHORTCUT_GALLERY_URL` is the seam for doing better later. Publish a real
 * shortcut from a device, put its iCloud link here, and this becomes a one-tap
 * install — with the key pasted in once on first run, since an iCloud shortcut
 * cannot carry a per-owner secret.
 * ---------------------------------------------------------------------------
 */
const SHORTCUT_GALLERY_URL: string | null = null;

/** Masked to this many trailing characters when hidden. */
const VISIBLE_TAIL = 4;

function mask(token: string) {
  return `${"•".repeat(18)}${token.slice(-VISIBLE_TAIL)}`;
}

export function SiriIntegration({
  initialToken,
  createdAt,
}: {
  initialToken: string | null;
  /** Pre-formatted on the server, in the shop's timezone. */
  createdAt: string | null;
}) {
  const { toast } = useToast();
  const [token, setToken] = useState(initialToken);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"token" | "url" | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * Built in the browser from the origin actually being used, rather than from
   * `NEXT_PUBLIC_APP_URL`. An owner setting this up on a preview deployment or
   * a custom domain should get a URL that works where they are standing, and
   * the one thing worse than no instructions is instructions pointing at the
   * wrong host.
   */
  const endpoint = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/api/siri/v1?action=next&token=${token}`
    : null;

  async function copy(value: string, what: "token" | "url") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is refused without a secure context or a user gesture the
      // browser believes in. Saying so beats a button that silently does
      // nothing.
      toast("הדפדפן חסם את ההעתקה — אפשר לסמן ולהעתיק ידנית", "error");
    }
  }

  function generate() {
    setConfirmingRegenerate(false);
    startTransition(async () => {
      const result = await generateSiriTokenAction();
      if (result.ok) {
        setToken(result.token);
        setRevealed(true);
        toast(result.message);
      } else {
        toast(result.error, "error");
      }
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeSiriTokenAction();
      if (result.ok) {
        setToken(null);
        setRevealed(false);
        toast(result.message);
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className={cn(cardClass, "p-4")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[image:var(--brand-gradient)] text-white"
        >
          <Mic className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
            שליטה קולית ביומן עם Siri
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            שאלו את Siri &laquo;מה התור הבא שלי?&raquo; או &laquo;כמה תורים יש
            לי היום?&raquo; ותקבלו תשובה בקול, בלי לפתוח את האפליקציה.
          </p>
        </div>
      </div>

      {token ? (
        <>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              המפתח האישי שלכם
            </p>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded-xl bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {revealed ? token : mask(token)}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((on) => !on)}
                aria-label={revealed ? "הסתרת המפתח" : "הצגת המפתח"}
                className={cn(btnSecondary, "size-9 shrink-0 px-0")}
              >
                {revealed ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => copy(token, "token")}
                className={cn(btnSecondary, "h-9 shrink-0 px-3 text-xs")}
              >
                {copied === "token" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                העתק מפתח
              </button>
            </div>
            {createdAt ? (
              <p className="mt-1.5 text-[11px] text-zinc-400">
                נוצר ב-{createdAt}. מי שמחזיק במפתח יכול לשמוע את היומן שלכם —
                אל תשתפו אותו.
              </p>
            ) : null}
          </div>

          {/* The four steps, in the order they are performed on the phone. */}
          <ol className="mt-4 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {[
              "פתחו את אפליקציית «קיצורי דרך» באייפון ← + ← «הוסף פעולה».",
              "בחרו «קבל תוכן מכתובת אתר» והדביקו את הכתובת שלמטה.",
              "הוסיפו «קבל ערך מילון» עם המפתח spoken_text, ואחריו «הקרא טקסט».",
              "קראו לקיצור בשם שתגידו ל-Siri — למשל «התור הבא שלי».",
            ].map((step, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                >
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              הכתובת לקיצור הדרך
            </p>
            <code
              dir="ltr"
              className="block truncate rounded-xl bg-zinc-100 px-3 py-2 font-mono text-[11px] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {revealed
                ? endpoint
                : endpoint?.replace(token, mask(token)) /* keep the key hidden */}
            </code>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => endpoint && copy(endpoint, "url")}
              className={cn(btnPrimary, "h-10 px-4 text-xs")}
            >
              {copied === "url" ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              העתקת הכתובת לקיצור הדרך
            </button>

            {SHORTCUT_GALLERY_URL ? (
              <a
                href={SHORTCUT_GALLERY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(btnSecondary, "h-10 px-4 text-xs")}
              >
                הורדת קיצור הדרך המוכן
              </a>
            ) : null}

            {confirmingRegenerate ? (
              <>
                <button
                  type="button"
                  onClick={generate}
                  disabled={pending}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60",
                  )}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  כן, החלף מפתח
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRegenerate(false)}
                  className={cn(btnSecondary, "h-10 px-3 text-xs")}
                >
                  ביטול
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRegenerate(true)}
                disabled={pending}
                className={cn(btnSecondary, "h-10 px-3 text-xs")}
              >
                <KeyRound className="size-4" aria-hidden />
                מפתח חדש
              </button>
            )}

            <button
              type="button"
              onClick={revoke}
              disabled={pending}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-zinc-500 transition-colors hover:text-red-600 disabled:opacity-60"
            >
              <Unplug className="size-4" aria-hidden />
              ניתוק
            </button>
          </div>

          {confirmingRegenerate ? (
            <p
              role="alert"
              className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400"
            >
              קיצורי הדרך שכבר הגדרתם יפסיקו לעבוד ויצטרכו את המפתח החדש.
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className={cn(btnPrimary, "h-10 px-4 text-xs")}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-4" aria-hidden />
            )}
            חיבור ל-Siri 🎙️
          </button>
          <p className="mt-2 text-[11px] text-zinc-400">
            נוצר מפתח אישי שמאפשר לאייפון שלכם לשאול על היומן. אפשר לנתק בכל רגע.
          </p>
        </div>
      )}
    </div>
  );
}
