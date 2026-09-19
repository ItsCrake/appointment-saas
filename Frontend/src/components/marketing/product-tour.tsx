import type { ReactNode } from "react";
import { CalendarRange, MessageCircle, Users } from "lucide-react";

import { MockPhone } from "./mock-kit";
import { ClientsScreen, RequestsScreen, WeekScreen } from "./mock-screens";

/**
 * Three screens, each answering a question a shop owner actually asks.
 *
 * ---------------------------------------------------------------------------
 * **Three, not nine.** Showing every screen would be a gallery — the visitor
 * scrolls past a wall of near-identical Hebrew UI and learns nothing. Each of
 * these three is here because it is the evidence for one of the claims this
 * page makes, and the caption states the claim rather than narrating the
 * picture.
 *
 * **Drawn with the product's own glass, so they stay the product.** These were
 * photographs of the real app, and every design pass left them a version
 * behind — the floating dock, the glass cards and edit mode were all missing
 * from them. They are drawn now from the dashboard's own classes (see
 * `mock-kit`): the same cards, chips and dock the app renders, scaled from a
 * 390px screen into the frame, so the page moves when the product does. Sample
 * names, and a description on every frame.
 *
 * **Alternating sides, not a three-column grid.** Equal-width cards of
 * icon-plus-heading-plus-picture is the shape every template ships; a wide
 * alternating layout gives each screen room to be legible at phone resolution
 * and lets the copy breathe beside it.
 * ---------------------------------------------------------------------------
 */

const TOUR = [
  {
    key: "week",
    Screen: WeekScreen,
    alt: "היומן השבועי במצב עריכה: תורים כמעט בכל יום, בקשה אחת בכתום, תור אחד שנבחר להחלפה, ותור שנגרר לשעה חדשה עם מסגרת מקווקוות במקום שבו ינחת",
    Icon: CalendarRange,
    title: "יומן שבועי שמזיזים באצבע",
    body: "כל התורים, החסימות והצוות במקום אחד. במצב עריכה גוררים תור לשעה או ליום אחר והוא נוחת בקפיצות של חמש דקות, או מקישים על שני תורים, מאשרים — והם מתחלפים. היומן מסמן מראש איפה כבר תפוס — ואם משהו לא נשמר, התור חוזר למקומו.",
    points: ["גרירה בקפיצות של 5 דקות", "החלפה בין שני תורים", "חסימות וצבע לכל נותן שירות"],
  },
  {
    key: "requests",
    Screen: RequestsScreen,
    alt: "מסך היומן עם שתי בקשות תור הממתינות לאישור, וכפתורי אישור ודחייה לכל אחת",
    Icon: MessageCircle,
    title: "אתם מאשרים, הלקוח מקבל הודעה",
    body: "אפשר לדרוש אישור לשירות מסוים — בדיוק לטיפולים הארוכים — בלי להפוך כל תספורת לבקשה. המועד נשמר ללקוח בזמן שאתם מחליטים, וההודעה בוואטסאפ יוצאת ברגע שאישרתם.",
    points: ["אישור לפי שירות", "המועד נשמר בינתיים", "וואטסאפ אוטומטי"],
  },
  {
    key: "clients",
    Screen: ClientsScreen,
    alt: "רשימת לקוחות עם מספר תורים, מתי היה הביקור האחרון, סימון הערות וכפתורי חיוג ווואטסאפ",
    Icon: Users,
    title: "הלקוחות נבנים מעצמם",
    body: "כל מי שקבע תור נכנס לרשימה עם היסטוריית הביקורים שלו. בלי הקלדה, בלי ייבוא — חיוג או וואטסאפ במרחק לחיצה, והערות אישיות נשמרות לפעם הבאה.",
    points: ["נבנה מהתורים עצמם", "היסטוריה לכל לקוח", "חיוג ווואטסאפ ישיר"],
  },
] as const satisfies readonly { Screen: () => ReactNode; [k: string]: unknown }[];

export function ProductTour() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 sm:px-8">
      <ul className="space-y-20 sm:space-y-28">
        {TOUR.map(({ key, Screen, alt, Icon, title, body, points }, i) => {
          return (
            <li
              key={key}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              {/* The screen alternates sides. `lg:order-last` on the odd rows
                rather than two separate layouts, so the DOM order stays
                copy-then-picture — which is also the order a screen reader
                and a narrow viewport both want. */}
              <div className={i % 2 === 1 ? "lg:order-last" : undefined}>
                <MockPhone label={alt} className="max-w-[19rem]">
                  <Screen />
                </MockPhone>
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
