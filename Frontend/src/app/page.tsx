import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
  CalendarCheck,
  Link2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";

// No database access and no dynamic APIs, so this prerenders as static HTML
// and is served from the edge cache. Keep it that way.

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

const STEPS = [
  {
    title: "הגדרת שירותים ושעות",
    body: "מגדירים מה אתם נותנים, כמה זמן כל טיפול לוקח ומתי אתם פתוחים. חמש דקות, פעם אחת.",
  },
  {
    title: "שיתוף קישור אישי",
    body: "מקבלים כתובת משלכם. שולחים בוואטסאפ, מצמידים לביו באינסטגרם, מדפיסים על כרטיס ביקור.",
  },
  {
    title: "קבלת תורים אוטומטית",
    body: "הלקוחות קובעים לבד, מסביב לשעון. אתם רואים הכול ביומן אחד מסודר.",
  },
] as const;

const FEATURES = [
  {
    icon: BellRing,
    title: "תזכורות אוטומטיות",
    body: "תזכורת נשלחת ללקוח לפני התור, בזמן שאתם קובעים. פחות שכחות, פחות חלונות ריקים ביומן.",
  },
  {
    icon: Link2,
    title: "ביטול עצמאי",
    body: "לקוח שלא יכול להגיע מבטל בעצמו דרך קישור אישי — והמועד מתפנה מיד להזמנה הבאה.",
  },
  {
    icon: ShieldCheck,
    title: "אפס כפילויות",
    body: "גם אם שני לקוחות לוחצים על אותה שעה באותו רגע, רק אחד יקבל אותה. זה נאכף במסד הנתונים עצמו.",
  },
  {
    icon: Smartphone,
    title: "בנוי לנייד",
    body: "רוב הלקוחות קובעים מהטלפון. העמוד מהיר, בעברית ומימין לשמאל — בלי אפליקציה ובלי הרשמה.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-white/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              <CalendarCheck className="size-4" />
            </span>
            <span className="font-bold text-neutral-900 dark:text-neutral-50">
              זימון תורים
            </span>
          </Link>

          <nav className="flex items-center gap-2">
            {/* h-10 keeps both a comfortable thumb target in the header. */}
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              כניסה
            </Link>
            <Link
              href="/dashboard/setup"
              className="inline-flex h-10 items-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              התחל עכשיו
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-5 pt-16 pb-12 text-center sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
            <Sparkles className="size-3.5" aria-hidden />
            למספרות, קוסמטיקאיות, מטפלים וכל עסק שעובד לפי תורים
          </p>

          <h1 className="mx-auto max-w-3xl text-4xl leading-tight font-bold tracking-tight text-balance text-neutral-900 sm:text-5xl dark:text-neutral-50">
            קבלו תורים אונליין.
            <br className="hidden sm:block" /> בלי טלפונים, בלי בלאגן.
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-neutral-600 sm:text-lg dark:text-neutral-400">
            עמוד הזמנות אישי לעסק שלכם. הלקוחות בוחרים שירות, יום ושעה בשלוש
            נגיעות — בלי הרשמה ובלי סיסמאות. אתם מקבלים יומן מסודר ותזכורות
            שנשלחות מעצמן.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/dashboard/setup"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-7 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 sm:w-auto dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              התחילו בחינם
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
            <Link
              href="/demo-barber"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-neutral-300 px-7 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 sm:w-auto dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              לצפייה בהדגמה
            </Link>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            ההקמה לוקחת כחמש דקות. אין צורך בכרטיס אשראי.
          </p>
        </section>

        {/* Live demo — the fastest way to understand the product is to use it. */}
        <section className="mx-auto w-full max-w-3xl px-5 pb-16">
          <Link
            href="/demo-barber"
            className="group flex flex-col items-start gap-4 rounded-2xl border border-neutral-200 bg-gradient-to-l from-neutral-50 to-white p-6 transition-colors hover:border-neutral-400 sm:flex-row sm:items-center dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950 dark:hover:border-neutral-600"
          >
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"
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
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              להדגמה
              <ArrowLeft
                className="size-4 transition-transform group-hover:-translate-x-1"
                aria-hidden
              />
            </span>
          </Link>
        </section>

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
                    className="flex size-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white dark:bg-neutral-100 dark:text-neutral-900"
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

        <section className="mx-auto w-full max-w-5xl px-5 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            מה מקבלים
          </h2>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-neutral-900 dark:text-neutral-50">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto w-full max-w-3xl px-5 pb-20">
          <div className="rounded-2xl bg-neutral-900 px-6 py-12 text-center dark:bg-neutral-100">
            <h2 className="text-2xl font-bold tracking-tight text-white dark:text-neutral-900">
              היומן שלכם, מסודר מהיום
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-neutral-300 dark:text-neutral-600">
              הקימו את עמוד ההזמנות שלכם ושתפו את הקישור עוד היום.
            </p>
            <Link
              href="/dashboard/setup"
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-8 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800"
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
          <nav className="flex items-center gap-5 text-xs text-neutral-500">
            <Link
              href="/demo-barber"
              className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              הדגמה
            </Link>
            <Link
              href="/login"
              className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              כניסה לבעלי עסקים
            </Link>
            <Link
              href="/dashboard/setup"
              className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              הרשמה
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
