import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DashboardMockup } from "@/components/marketing/dashboard-mockup";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { HeroParticles } from "@/components/marketing/hero-particles";
import { PricingTable } from "@/components/marketing/pricing-table";
import { TypewriterLogo } from "@/components/marketing/typewriter-logo";
import { BRAND, BRAND_MARK } from "@/lib/brand";
import { FAQS, FEATURES, STEPS } from "@/lib/landing-content";
import { TRIAL_DAYS } from "@/lib/plans";

// No database access and no dynamic APIs, so this prerenders as static HTML
// and is served from the edge cache. Keep it that way — the pricing toggle and
// the FAQ accordion are client islands precisely so this page need not be.

/* ---------------------------------------------------------------------------
   Design system for this page, stated once so nothing drifts.

   PALETTE — monochrome, no accent hue anywhere. Ink is zinc-950 (#09090b),
   never pure #000: pure black flattens against a shadow and kills depth.
   Paper is white, aluminium is the zinc-200..600 ramp. In a system with no
   accent, contrast *is* the accent, which is why every primary action is
   solid ink on paper and inverts wholesale in dark mode.

   SHAPE — radius 0, everywhere, no exceptions. Rounded corners are the single
   loudest tell of a generated page; a hard edge is what makes a monochrome
   layout read as considered rather than as unstyled.

   ORDER IN RTL — the document is dir="rtl", so grid column 1 renders on the
   *right*. The hero's dark panel therefore carries `lg:order-2` to sit on the
   visual left while staying first in the DOM, where its <h1> belongs.
--------------------------------------------------------------------------- */

export const metadata: Metadata = {
  title: { absolute: BRAND.title },
  description: BRAND.tagline,
  alternates: { canonical: "/" },
  keywords: [
    // The generic terms stay: they are what people actually search for, and
    // nobody looks for a brand they have not heard of yet.
    BRAND.name,
    BRAND.nameHe,
    "זימון תורים",
    "קביעת תורים אונליין",
    "יומן תורים לעסק",
    "מערכת תורים",
    "תורים למספרה",
  ],
  openGraph: {
    title: BRAND.title,
    description: BRAND.tagline,
    url: "/",
    type: "website",
    locale: "he_IL",
  },
  twitter: {
    card: "summary",
    title: BRAND.title,
    description: BRAND.tagline,
  },
};

/**
 * One label per intent, reused verbatim in the nav, the hero and the closing
 * section. Three different phrasings of "sign up" across one page reads as
 * three different offers.
 */
const CTA_SIGNUP = "התחלת ניסיון";
const CTA_DEMO = "צפייה בהדגמה";

/** Solid ink on paper: 19:1 in light mode, and the same inverted in dark. */
const btnPrimary =
  "inline-flex items-center justify-center gap-2 bg-zinc-950 px-6 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white";

const btnGhost =
  "inline-flex items-center justify-center gap-2 border border-zinc-300 px-6 text-sm font-semibold whitespace-nowrap text-zinc-900 transition-colors hover:border-zinc-950 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-100 dark:hover:bg-zinc-900 dark:focus-visible:ring-white";

const sectionTitle =
  "text-3xl font-black tracking-tighter text-zinc-950 sm:text-4xl dark:text-zinc-50";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-zinc-950">
      {/* Edge to edge, one hairline underneath, 64px tall. No blur and no
          translucency: a frosted bar over a hard black/white split shows the
          seam bleeding through it. */}
      <header className="sticky top-0 z-20 h-16 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-full w-full max-w-[1400px] items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="text-lg font-black tracking-tighter text-zinc-950 dark:text-zinc-50"
          >
            {BRAND_MARK.stem}
            <span className="text-zinc-400">{BRAND_MARK.dot}</span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#pricing"
              className="hidden h-10 items-center px-3 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-950 sm:inline-flex dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              מחירים
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center px-3 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              כניסה
            </Link>
            <Link href="/dashboard/setup" className={`${btnPrimary} h-10`}>
              {CTA_SIGNUP}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO — exactly 70% of the viewport below the header, so the section
            beneath it occupies the remaining 30% and peeks above the fold. The
            floor stops it collapsing on a short laptop, where 70% of 500px
            would crush the mockup. */}
        <section className="grid h-[calc((100dvh-4rem)*0.7)] min-h-[30rem] grid-cols-1 grid-rows-[9rem_1fr] lg:h-[calc((100dvh-4rem)*0.7)] lg:min-h-[28rem] lg:grid-cols-2 lg:grid-rows-1">
          {/* Left on desktop, top on mobile. */}
          <div className="relative flex items-center justify-center overflow-hidden bg-zinc-950 lg:order-2">
            <HeroParticles className="absolute inset-0 h-full w-full" />
            <TypewriterLogo className="relative px-6 text-center" />
          </div>

          {/* Right on desktop, below on mobile. */}
          <div className="relative flex flex-col justify-center bg-white px-6 py-8 sm:px-10 lg:order-1 lg:px-12 xl:px-16 dark:bg-zinc-900">
            <div className="mx-auto w-full max-w-lg">
              <p className="max-w-[38ch] text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-300">
                עמוד הזמנות אישי לעסק שלכם. הלקוחות קובעים תור בעצמם, והיומן
                מתמלא בלי חורים ובלי טלפונים.
              </p>

              {/* A scaled render of the real agenda, not a screenshot of one.
                  Hidden below lg: at phone width it shrinks to unreadable and
                  only pushes the actions off screen. */}
              <div className="mt-8 hidden lg:block">
                <DashboardMockup />
              </div>

              {/* Width, never flex, controls the mobile stack. `flex-1` inside
                  a flex-col parent sizes the *cross axis*, which silently beat
                  `h-12` and squashed both buttons to 20px: under the 44px
                  minimum touch target, and invisible in a desktop-only check. */}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard/setup"
                  className={`${btnPrimary} h-12 w-full sm:w-auto`}
                >
                  {CTA_SIGNUP}
                  <ArrowLeft className="size-4" aria-hidden />
                </Link>
                <Link
                  href="/demo-barber"
                  className={`${btnGhost} h-12 w-full sm:w-auto`}
                >
                  {CTA_DEMO}
                </Link>
              </div>
            </div>

            {/* The peek below is deliberate, and this says so. A hairline that
                draws downward and retracts, with no label and no wheel icon:
                the movement is the whole message. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-5 mx-auto hidden h-10 w-px bg-zinc-300 lg:block dark:bg-zinc-700"
            >
              <span className="animate-scroll-hint block h-full w-full bg-zinc-950 dark:bg-zinc-100" />
            </span>
          </div>
        </section>

        {/* PEEK TARGET — the 30% below the fold. Full-bleed ink band, so what
            shows above the fold is a hard tonal change rather than more of the
            same white. */}
        <section className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="mx-auto w-full max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
            <Link
              href="/demo-barber"
              className="group flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
            >
              <span className="max-w-2xl">
                <span className={`${sectionTitle} block`}>
                  אפשר לראות איך זה נראה ללקוח
                </span>
                <span className="mt-3 block text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                  עמוד ההדגמה של מספרת רון פתוח לכולם. קבעו בו תור אמיתי,
                  מהטלפון, בפחות מדקה.
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-2 border-b-2 border-zinc-950 pb-1 text-sm font-bold text-zinc-950 dark:border-zinc-50 dark:text-zinc-50">
                {CTA_DEMO}
                <ArrowLeft
                  className="size-4 transition-transform duration-300 group-hover:-translate-x-1"
                  aria-hidden
                />
              </span>
            </Link>
          </div>
        </section>

        {/* HOW IT WORKS — hairline-topped columns. No step numerals: the order
            is the order, and "שלב 1" adds a word without adding meaning. */}
        <section className="mx-auto w-full max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
          <h2 className={sectionTitle}>איך זה עובד</h2>
          <ol className="mt-12 grid gap-px bg-zinc-200 sm:grid-cols-3 dark:bg-zinc-800">
            {STEPS.map((step) => (
              <li
                key={step.title}
                className="bg-white pt-6 sm:px-6 sm:pt-8 dark:bg-zinc-950"
              >
                <h3 className="text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {step.title}
                </h3>
                <p className="mt-2 pb-6 text-sm leading-relaxed text-zinc-600 sm:pb-8 dark:text-zinc-400">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* FEATURES — editorial two-column list, not a card grid. Six equal
            bordered boxes is the shape every generated page reaches for. */}
        <section className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto w-full max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
            <h2 className={sectionTitle}>מה מקבלים</h2>
            <dl className="mt-12 grid gap-x-16 gap-y-10 md:grid-cols-2">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="border-t border-zinc-200 pt-5 dark:border-zinc-800"
                >
                  <dt className="text-base font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                    {feature.title}
                  </dt>
                  <dd className="mt-1.5 max-w-[52ch] text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {feature.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* PRICING */}
        <section
          id="pricing"
          className="scroll-mt-16 border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
        >
          <div className="mx-auto w-full max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
            <h2 className={sectionTitle}>מחירים פשוטים</h2>
            <p className="mt-3 max-w-md text-base text-zinc-600 dark:text-zinc-400">
              {TRIAL_DAYS} ימי ניסיון בחינם בשני המסלולים. בלי כרטיס אשראי ובלי
              התחייבות.
            </p>
            <div className="mt-10">
              <PricingTable />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto w-full max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
            <h2 className={sectionTitle}>שאלות נפוצות</h2>
            <div className="mt-10">
              <FaqAccordion items={FAQS} />
            </div>
          </div>
        </section>

        {/* CLOSING — full-bleed ink. The one place the page inverts, and it
            closes the composition the hero's dark panel opened. */}
        <section className="bg-zinc-950">
          <div className="mx-auto w-full max-w-[1400px] px-5 py-24 text-center sm:px-8 sm:py-32">
            <h2 className="text-3xl font-black tracking-tighter text-white sm:text-5xl">
              היומן שלכם, מסודר מהיום
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-zinc-400">
              הקימו את עמוד ההזמנות שלכם ושתפו את הקישור עוד היום.
            </p>
            <Link
              href="/dashboard/setup"
              className="mt-10 inline-flex h-12 items-center justify-center gap-2 bg-white px-8 text-sm font-semibold whitespace-nowrap text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none active:translate-y-px"
            >
              {CTA_SIGNUP}
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row sm:px-8">
          {/* No new Date() here: this page is prerendered, so the year would
              freeze at build time and quietly go stale between deploys. */}
          <p className="text-xs text-zinc-500">
            © {BRAND.name}. כל הזכויות שמורות.
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-500">
            <Link
              href="/demo-barber"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              הדגמה
            </Link>
            <Link
              href="#pricing"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              מחירים
            </Link>
            <Link
              href="/login"
              className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
            >
              כניסה לבעלי עסקים
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
