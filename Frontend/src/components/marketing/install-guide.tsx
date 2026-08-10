import { BellRing, Plus, Share, Smartphone } from "lucide-react";

/**
 * How to put the dashboard on a phone's home screen, and switch on
 * notifications once it is there.
 *
 * ---------------------------------------------------------------------------
 * Two columns because **iOS and Android are genuinely different**, and a single
 * set of steps written for one of them is the reason most PWAs go uninstalled.
 * On Android the browser offers an install banner; on iOS there is no prompt at
 * all, only a Share menu that people do not think to open.
 *
 * The iOS ordering matters and is stated: Safari will not offer notification
 * permission at all until the app has been added to the home screen. An owner
 * who tries it the other way round concludes notifications are broken, and
 * a refused prompt cannot be asked for again.
 * ---------------------------------------------------------------------------
 */

const STEPS = [
  {
    platform: "אייפון",
    note: "בספארי בלבד — בכרום באייפון אין אפשרות התקנה",
    icon: Share,
    steps: [
      "פתחו את הדשבורד בספארי",
      "לחצו על כפתור השיתוף בתחתית המסך",
      'גללו ובחרו "הוספה למסך הבית"',
      "פתחו את האפליקציה מהמסך ורק אז הפעילו התראות בהגדרות",
    ],
  },
  {
    platform: "אנדרואיד",
    note: "כרום יציע להתקין לבד אחרי ביקור שני",
    icon: Plus,
    steps: [
      "פתחו את הדשבורד בכרום",
      'אשרו את ההצעה "התקנת האפליקציה", או בחרו אותה מתפריט שלוש הנקודות',
      "פתחו את האפליקציה מהמסך",
      "הפעילו התראות בהגדרות → התראות למכשיר",
    ],
  },
] as const;

export function InstallGuide() {
  return (
    <section
      id="install"
      className="border-y border-zinc-200 dark:border-zinc-800"
    >
      <div className="mx-auto w-full max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[image:var(--brand-gradient)] px-3 py-1 text-xs font-semibold text-white">
            <Smartphone className="size-3.5" aria-hidden />
            אפליקציה בלי חנות אפליקציות
          </span>

          <h2 className="mt-4 text-3xl font-black tracking-tighter text-zinc-950 sm:text-4xl dark:text-zinc-50">
            היומן על מסך הבית, עם התראה על כל תור
          </h2>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            שתי דקות, בלי הורדה מחנות ובלי אישורים. הלקוחות שלכם לא צריכים
            להתקין כלום — זה רק בשבילכם.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
          {STEPS.map(({ platform, note, icon: Icon, steps }) => (
            <div
              key={platform}
              className="rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <Icon className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-zinc-950 dark:text-zinc-50">
                    {platform}
                  </h3>
                  <p className="text-[11px] text-zinc-500">{note}</p>
                </div>
              </div>

              {/* An ordered list, because the order is the content — on iOS
                  notifications cannot be granted before the install. */}
              <ol className="mt-4 space-y-2.5">
                {steps.map((step, index) => (
                  <li
                    key={step}
                    className="flex gap-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-[10px] font-bold text-white"
                    >
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-6 flex max-w-2xl items-start justify-center gap-2 text-center text-xs leading-relaxed text-zinc-500">
          <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            אחרי ההתקנה תקבלו התראה לנייד ברגע שנקבע תור חדש — גם כשהאפליקציה
            סגורה. אפשר לכבות בכל רגע מההגדרות.
          </span>
        </p>
      </div>
    </section>
  );
}
