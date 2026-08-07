import Link from "next/link";

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
  return (
    <p className={`text-[11px] leading-relaxed text-zinc-500 ${className}`}>
      בלחיצה על {action}, הנך מסכים ל
      <Link
        href="/legal/terms"
        target="_blank"
        className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        תנאי השימוש
      </Link>{" "}
      ול
      <Link
        href="/legal/privacy"
        target="_blank"
        className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        מדיניות הפרטיות
      </Link>
      .
    </p>
  );
}
