import Link from "next/link";

import { BRAND_MARK } from "@/lib/brand";
import { LEGAL_ENTITY, type LegalSection } from "@/lib/legal-content";

/**
 * Shared chrome for the three legal pages, so they cannot drift apart in
 * typography or in the small print at the bottom.
 *
 * Static and prerendered: these documents have no dynamic content, and a
 * privacy policy that needs a database query to render is a privacy policy
 * that can 500.
 */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro?: string;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-full bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center px-5">
          <Link
            href="/"
            className="text-lg font-black tracking-tighter text-zinc-950 dark:text-zinc-50"
          >
            {BRAND_MARK.stem}
            <span className="text-zinc-400">{BRAND_MARK.dot}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
        <h1 className="text-3xl font-black tracking-tighter text-zinc-950 sm:text-4xl dark:text-zinc-50">
          {title}
        </h1>
        <p className="mt-2 text-xs text-zinc-500">
          עדכון אחרון: {LEGAL_ENTITY.lastUpdated}
        </p>
        {intro ? (
          <p className="mt-5 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
            {intro}
          </p>
        ) : null}

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map((paragraph, i) => (
                  <p
                    key={i}
                    className="max-w-[68ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-14 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="text-xs leading-relaxed text-zinc-500">
            {LEGAL_ENTITY.name} · ח.פ. {LEGAL_ENTITY.registrationNumber} ·{" "}
            {LEGAL_ENTITY.email}
          </p>
          <nav className="mt-4 flex flex-wrap gap-5 text-xs text-zinc-500">
            <Link
              href="/legal/terms"
              className="hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              תנאי שימוש
            </Link>
            <Link
              href="/legal/privacy"
              className="hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              מדיניות פרטיות
            </Link>
            <Link
              href="/accessibility"
              className="hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              הצהרת נגישות
            </Link>
            <Link
              href="/"
              className="hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              חזרה לאתר
            </Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}
