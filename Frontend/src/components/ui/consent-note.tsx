import Link from "next/link";

import { useCopy } from "@/components/booking/copy-context";

/**
 * The implicit-consent line that sits under a primary action.
 *
 * Placed *under the button rather than beside a checkbox* on purpose: for a
 * booking there is no account and no ongoing relationship, and a required
 * tickbox in front of a one-minute booking flow costs completions without
 * adding meaningful consent. The action itself is the agreement, and the terms
 * are one tap away.
 *
 * A separate component so the wording and the links stay identical everywhere
 * they appear — two slightly different consent sentences is exactly the kind
 * of inconsistency that undermines the claim that consent was given.
 */
export function ConsentNote({
  action,
  className = "",
}: {
  /** The verb as it reads in the sentence, e.g. "הרשמה" or "קביעת תור". */
  action: string;
  className?: string;
}) {
  // Outside a `BookingCopyProvider` — which is everywhere but the public
  // booking page — this resolves to Hebrew and returns each fallback
  // unchanged, so `/login` renders exactly the sentence it always has.
  const t = useCopy();

  return (
    <p className={`text-[11px] leading-relaxed text-zinc-500 ${className}`}>
      {t("consent.before", "בלחיצה על")} {action}
      {t("consent.middle", ", הנך מסכים ל")}
      <Link
        href="/legal/terms"
        target="_blank"
        className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {t("consent.terms", "תנאי השימוש")}
      </Link>{" "}
      {t("consent.and", "ול")}
      <Link
        href="/legal/privacy"
        target="_blank"
        className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {t("consent.privacy", "מדיניות הפרטיות")}
      </Link>
      .
    </p>
  );
}
