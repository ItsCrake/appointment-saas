import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
  CalendarCheck,
  ChartNoAxesColumn,
  Palette,
  ShieldCheck,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { DashboardMockup } from "@/components/marketing/dashboard-mockup";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { PricingTable } from "@/components/marketing/pricing-table";
import { TypewriterLogo } from "@/components/marketing/typewriter-logo";
import { FAQS, FEATURES, STEPS, type FeatureIcon } from "@/lib/landing-content";
import { TRIAL_DAYS } from "@/lib/plans";

// No database access and no dynamic APIs, so this prerenders as static HTML
// and is served from the edge cache. Keep it that way — the pricing toggle and
// the FAQ accordion are client islands precisely so this page need not be.

export const metadata: Metadata = {
  title: { absolute: "זימון תורים אונליין לעסקים קטנים" },
  description:
    "עמוד הזמנות אישי לעסק שלכם. הלקוחות קובעים תור בשלוש נגיעות, בלי טלפונים ובלי הרשמה — ואתם מקבלים יומן מסודר עם תזכורות אוטומטיות.",
  alternates: { canonical: "/" },
  keywords: [
    "זימון תורים",
    "קביעת תורים אונליין",
    "יומן תורים לעסק",
    "מערכת תורים",
    "תורים למספרה",
  ],
  openGraph: {
    title: "זימון תורים אונליין לעסקים קטנים",
    description:
      "עמוד הזמנות אישי לעסק שלכם. הלקוחות קובעים תור בשלוש נגיעות, ואתם מקבלים יומן מסודר עם תזכורות אוטומטיות.",
    url: "/",
    type: "website",
    locale: "he_IL",
  },
  twitter: {
    card: "summary",
    title: "זימון תורים אונליין לעסקים קטנים",
    description: "עמוד הזמנות אישי לעסק שלכם. בלי טלפונים, בלי בלאגן.",
  },
};

/**
 * The content module stores icon *names* so it stays plain data. This is the
 * one place a name becomes a component.
 */
const FEATURE_ICONS: Record<FeatureIcon, LucideIcon> = {
  smartphone: Smartphone,
  bell: BellRing,
  calendar: CalendarCheck,
  palette: Palette,
  chart: ChartNoAxesColumn,
  shield: ShieldCheck,
};

/** teal-700, not teal-600: white on teal-600 measures ~3.4:1 and fails AA. */
const CTA_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg bg-teal-700 text-white"
            >
              <CalendarCheck className="size-4" />
            </span>
            <span className="font-bold text-neutral-900 dark:text-neutral-50">
              זימון תורים
            </span>
          </Link>

          <nav className="flex items-center gap-2">
            <Link
              href="#pricing"
              className="hidden h-10 items-center rounded-lg px-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 sm:inline-flex dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              מחירים
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              כניסה
            </Link>
            <Link
              href="/dashboard/setup"
              className={`${CTA_PRIMARY} h-10 px-4 text-sm`}
            >
              התחל עכשיו
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — split: dark brand panel beside a product mockup.
            Capped at ~78vh on desktop so the band below shows above the fold. */}
        <section className="mx-auto flex w-full max-w-6xl items-center px-5 py-10 lg:min-h-[78vh] lg:py-12">
          <div className="grid w-full items-center gap-6 lg:grid-cols-2 lg:gap-10">
            {/* Brand panel */}
            <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-8 sm:p-10 lg:p-12">
              {/* Two soft teal pools instead of a flat gradient — cheap depth,
                  and they sit behind the text rather than tinting it. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -end-16 -top-24 size-64 rounded-full bg-teal-500/20 blur-3xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -start-20 -bottom-28 size-72 rounded-full bg-teal-400/10 blur-3xl"
              />

              <div className="relative">
                <p className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-teal-200">
                  <Sparkles className="size-3.5" aria-hidden />
                  מערכת זימון תורים לעסקים קטנים
                </p>

                <TypewriterLogo />

                <p className="mt-5 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
                  ניהול תורים חכם, מדויק וללא חורים ביומן.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/dashboard/setup"
                    className={`${CTA_PRIMARY} h-12 px-6 text-sm`}
                  >
                    התחל ניסיון חינם
                    <ArrowLeft className="size-4" aria-hidden />
                  </Link>
                  <Link
                    href="/demo-barber"
                    className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 px-6 text-sm font-semibold text-white transition-colors hover:border-teal-400 hover:text-teal-200 focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
                  >
                    נסה דמו בלייב
                  </Link>
                </div>

                <p className="mt-5 text-xs text-slate-400">
                  {TRIAL_DAYS} ימי ניסיון · ההקמה לוקחת כחמש דקות · בלי כרטיס
                  אשראי
                </p>
              </div>
            </div>

            {/* Product mockup. Hidden below lg: a shrunken dashboard is
                unreadable on a phone and only pushes the CTAs off screen. */}
            <div className="hidden lg:block">
              <DashboardMockup />
            </div>
          </div>
        </section>

        {/* Live demo — the fastest way to understand the product is to use it. */}
        <section className="mx-auto w-full max-w-3xl px-5 pb-16">
          <Link
            href="/demo-barber"
            className="group flex flex-col items-start gap-4 rounded-2xl border border-neutral-200 bg-gradient-to-l from-teal-50 to-white p-6 transition-colors hover:border-teal-600 sm:flex-row sm:items-center dark:border-neutral-800 dark:from-teal-950/40 dark:to-neutral-950 dark:hover:border-teal-700"
          >
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"
            >
              <CalendarCheck className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-neutral-900 dark:text-neutral-50">
                רוצים לראות איך זה נראה ללקוח?
              </span>
              <span className="mt-0.5 block text-sm text-neutral-600 dark:text-neutral-400">
                נסו לקבוע תור אמיתי בעמוד ההדגמה — מספרת רון. לוקח פחות מדקה.
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-teal-800 dark:text-teal-300">
              להדגמה
              <ArrowLeft
                className="size-4 transition-transform group-hover:-translate-x-1"
                aria-hidden
              />
            </span>
          </Link>
        </section>

        {/* How it works */}
        <section className="border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="mx-auto w-full max-w-5xl px-5 py-16">
            <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              איך זה עובד
            </h2>
            <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
              שלושה שלבים, פעם אחת.
            </p>

            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-semibold text-neutral-900 dark:text-neutral-50">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-5xl px-5 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            מה מקבלים
          </h2>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = FEATURE_ICONS[feature.icon];
              return (
                <li
                  key={feature.title}
                  className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span
                    aria-hidden
                    className="flex size-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                  >
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold text-neutral-900 dark:text-neutral-50">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                    {feature.body}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="scroll-mt-16 border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div className="mx-auto w-full max-w-5xl px-5 py-16">
            <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              מחירים פשוטים
            </h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-neutral-600 dark:text-neutral-400">
              {TRIAL_DAYS} ימי ניסיון בחינם בכל המסלולים. בלי כרטיס אשראי ובלי
              התחייבות.
            </p>

            <div className="mt-8">
              <PricingTable />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-5 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            שאלות נפוצות
          </h2>
          <div className="mt-8">
            <FaqAccordion items={FAQS} />
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-3xl px-5 pb-20">
          <div className="rounded-2xl bg-gradient-to-br from-teal-700 to-teal-900 px-6 py-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              היומן שלכם, מסודר מהיום
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-teal-50">
              הקימו את עמוד ההזמנות שלכם ושתפו את הקישור עוד היום.
            </p>
            <Link
              href="/dashboard/setup"
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-8 text-sm font-semibold text-teal-900 transition-colors hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-teal-800 focus-visible:outline-none"
            >
              התחילו בחינם
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          {/* No new Date() here: this page is prerendered, so the year would
              freeze at build time and quietly go stale between deploys. */}
          <p className="text-xs text-neutral-500">
            © זימון תורים. כל הזכויות שמורות.
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-5 text-xs text-neutral-500">
            <Link
              href="/demo-barber"
              className="transition-colors hover:text-teal-800 dark:hover:text-teal-300"
            >
              הדגמה
            </Link>
            <Link
              href="#pricing"
              className="transition-colors hover:text-teal-800 dark:hover:text-teal-300"
            >
              מחירים
            </Link>
            <Link
              href="/login"
              className="transition-colors hover:text-teal-800 dark:hover:text-teal-300"
            >
              כניסה לבעלי עסקים
            </Link>
            <Link
              href="/dashboard/setup"
              className="transition-colors hover:text-teal-800 dark:hover:text-teal-300"
            >
              הרשמה
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
