import { CalendarRange, MessageCircle, Users } from "lucide-react";

import { resolveScreenshot, type ScreenshotSlot } from "@/lib/screenshots";

import { DashboardMockup } from "./dashboard-mockup";
import { PhoneFrame } from "./phone-frame";

/**
 * Three real screens, each answering a question a shop owner actually asks.
 *
 * ---------------------------------------------------------------------------
 * **Three, not nine.** There are eight screenshots in `public/screenshots` and
 * showing them all would be a gallery — the visitor scrolls past a wall of
 * near-identical Hebrew UI and learns nothing. Each of these three is here
 * because it is the *only* evidence for one of the three claims this page
 * makes, and the caption states the claim rather than narrating the picture.
 *
 * **The screens are real, and that is the whole point.** Every competitor's
 * landing page draws its product in CSS. A photograph of the actual calendar —
 * with real overlapping bookings, a real pending-approval banner, real Hebrew
 * names — is the one thing on this page that cannot be faked, and it is aimed
 * at a reader who has already been sent a booking link and is wondering what
 * the other side looks like.
 *
 * **Alternating sides, not a three-column grid.** Equal-width cards of
 * icon-plus-heading-plus-picture is the shape every template ships; a wide
 * alternating layout gives each screen room to be legible at phone resolution
 * and lets the copy breathe beside it.
 * ---------------------------------------------------------------------------
 */

const TOUR = [
  {
    slot: "week-calendar",
    alt: "יומן שבועי של מספרה, עם תורים חופפים בשלושה ימים ושמות לקוחות",
    Icon: CalendarRange,
    title: "יומן שבועי שלא נשבר",
    body: "כל התורים, החסימות והצוות במקום אחד. תורים חופפים נערמים זה לצד זה במקום להסתיר אחד את השני, וההעברה בין ימי ושבועי היא לחיצה אחת.",
    points: ["תצוגה יומית ושבועית", "חסימות וזמני הפסקה", "צבע לכל נותן שירות"],
  },
  {
    slot: "approval-request",
    alt: "מסך היומן עם שתי בקשות תור הממתינות לאישור, וכפתורי אישור ודחייה לכל אחת",
    Icon: MessageCircle,
    title: "אתם מאשרים, הלקוח מקבל הודעה",
    body: "אפשר לדרוש אישור לשירות מסוים — בדיוק לטיפולים הארוכים — בלי להפוך כל תספורת לבקשה. המועד נשמר ללקוח בזמן שאתם מחליטים, וההודעה בוואטסאפ יוצאת ברגע שאישרתם.",
    points: ["אישור לפי שירות", "המועד נשמר בינתיים", "וואטסאפ אוטומטי"],
  },
  {
    slot: "clients",
    alt: "רשימת לקוחות עם מספר תורים, תאריך ביקור אחרון וכפתורי חיוג ווואטסאפ",
    Icon: Users,
    title: "הלקוחות נבנים מעצמם",
    body: "כל מי שקבע תור נכנס לרשימה עם היסטוריית הביקורים שלו. בלי הקלדה, בלי ייבוא — חיוג או וואטסאפ במרחק לחיצה, והערות אישיות נשמרות לפעם הבאה.",
    points: ["נבנה מהתורים עצמם", "היסטוריה לכל לקוח", "חיוג ווואטסאפ ישיר"],
  },
] as const satisfies readonly { slot: ScreenshotSlot; [k: string]: unknown }[];

export function ProductTour() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8">
      <ul className="space-y-20 sm:space-y-28">
        {TOUR.map(({ slot, alt, Icon, title, body, points }, i) => {
          // Resolved on the server: the HD file when one has been supplied,
          // the original otherwise, with the real pixel size either way.
          const shot = resolveScreenshot(slot);

          return (
            <li
              key={slot}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              {/* The screen alternates sides. `lg:order-last` on the odd rows
                rather than two separate layouts, so the DOM order stays
                copy-then-picture — which is also the order a screen reader
                and a narrow viewport both want. */}
              <div className={i % 2 === 1 ? "lg:order-last" : undefined}>
                <PhoneFrame
                  src={shot.src}
                  width={shot.width}
                  height={shot.height}
                  alt={alt}
                  // The drawn agenda, if the file is ever missing. It is the same
                  // component that carried this page before the screenshots
                  // existed, so the fallback is a downgrade rather than a hole.
                  fallback={<DashboardMockup className="relative" />}
                />
              </div>

              <div>
                <span className="mb-5 inline-flex size-11 items-center justify-center rounded-2xl bg-[image:var(--brand-gradient)] text-white shadow-[0_8px_24px_-8px_rgb(79_70_229/0.6)]">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>

                <h3 className="text-2xl font-bold tracking-[-0.02em] text-balance text-zinc-900 sm:text-3xl dark:text-zinc-50">
                  {title}
                </h3>

                <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-pretty text-zinc-600 sm:text-base dark:text-zinc-400">
                  {body}
                </p>

                <ul className="mt-6 flex flex-wrap gap-2">
                  {points.map((point) => (
                    <li
                      key={point}
                      className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-900/5 ring-inset dark:bg-zinc-800 dark:text-zinc-300 dark:ring-white/10"
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
