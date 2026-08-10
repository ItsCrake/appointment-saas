"use client";

import { useState } from "react";
import {
  BellRing,
  CalendarRange,
  ChevronDown,
  Link2,
  Palette,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Six features, one open at a time.
 *
 * ---------------------------------------------------------------------------
 * An accordion rather than six paragraphs, because the detail is what convinces
 * and the *list* is what gets read. Everything visible at once means six
 * headings skimmed and none of the sentences under them; one open at a time
 * means a person chose the thing they care about and is now reading about it.
 *
 * Exactly one open, and the first starts open. A closed accordion looks like a
 * page that has not loaded, and an all-closed default costs a tap before there
 * is anything to read.
 *
 * Buttons with `aria-expanded`, not a `<details>` per card: this is a single
 * exclusive group, and native details cannot express "opening this closes that"
 * without JavaScript anyway.
 * ---------------------------------------------------------------------------
 */

const FEATURES = [
  {
    icon: Link2,
    title: "קישור אחד, בלי אפליקציה",
    body: "הלקוחות פותחים את הקישור, בוחרים שירות ושעה, ומקבלים אישור. בלי הרשמה, בלי הורדה, בלי סיסמה — ולכן גם בלי לקוחות שמוותרים באמצע.",
  },
  {
    icon: CalendarRange,
    title: "לוח שבועי מלא",
    body: "כל התורים, הצוות והחסימות בגריד אחד. חסימה שאתם מוסיפים ליומן — הפסקה, סידורים — חוסמת אוטומטית גם קביעת תורים מהעמוד הציבורי.",
  },
  {
    icon: Users,
    title: "צוות, כל אחד והשעות שלו",
    body: "לכל נותן שירות שעות משלו, חופשות משלו וצבע ביומן. הלקוח בוחר שעה קודם ואת האדם אחר כך, כך שאף שעה פנויה לא נעלמת מהלוח.",
  },
  {
    icon: BellRing,
    title: "התראה על כל תור",
    body: "התראה לנייד ברגע שנקבע תור, גם כשהאפליקציה סגורה. ללקוח נשלחת תזכורת אוטומטית — יום מראש, או שעתיים לפני אם התור נקבע לאותו יום.",
  },
  {
    icon: Palette,
    title: "העמוד נראה כמו העסק",
    body: "צבע, לוגו, באנר או סרטון, גלריית עבודות וחוות דעת. הלקוח לא מרגיש שהוא עבר לאתר של מישהו אחר — וזה כלול כבר במסלול הבסיסי.",
  },
  {
    icon: CalendarRange,
    title: "תורים באישור",
    body: "אפשר להחליט שכל תור מגיע כבקשה שממתינה לאישור שלכם. המועד נשמר ללקוח בינתיים, כדי שלא ייתפס בזמן שאתם מחליטים.",
  },
] as const;

export function FeatureCards() {
  const [open, setOpen] = useState(0);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {FEATURES.map((feature, index) => {
        const isOpen = open === index;
        const Icon = feature.icon;

        return (
          <div
            key={feature.title}
            className={cn(
              "rounded-3xl border transition-colors",
              isOpen
                ? "border-transparent bg-[image:var(--brand-gradient)]"
                : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900",
            )}
          >
            <button
              type="button"
              // Toggling rather than only opening: a person who opened the
              // wrong one should be able to close it without hunting for
              // another.
              onClick={() => setOpen(isOpen ? -1 : index)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 p-5 text-start focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
                  isOpen
                    ? "bg-white/15 text-white"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                )}
              >
                <Icon className="size-5" />
              </span>

              <span
                className={cn(
                  "flex-1 text-base font-bold tracking-tight",
                  isOpen ? "text-white" : "text-zinc-950 dark:text-zinc-50",
                )}
              >
                {feature.title}
              </span>

              <ChevronDown
                aria-hidden
                className={cn(
                  "size-5 shrink-0 transition-transform duration-200",
                  isOpen ? "rotate-180 text-white/80" : "text-zinc-400",
                )}
              />
            </button>

            {/* Kept mounted and collapsed by grid rows rather than unmounted:
                the height animates, and the text stays in the DOM for find-in
                page and for a crawler reading the copy that does the selling. */}
            <div
              className={cn(
                "grid transition-all duration-200 ease-out",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p
                  className={cn(
                    "px-5 pb-5 text-sm leading-relaxed",
                    isOpen ? "text-white/85" : "text-zinc-600",
                  )}
                >
                  {feature.body}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
