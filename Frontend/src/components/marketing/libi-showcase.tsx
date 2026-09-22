import { AudioLines, Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { MockOrb } from "./mock-kit";

/**
 * ליבי, given a section of her own.
 *
 * ---------------------------------------------------------------------------
 * **The conversation, not a feature list.** What sells a voice assistant is
 * hearing one exchange go right, so the right-hand side plays one: the owner
 * says a move, she checks the diary, proposes it with the change on a button,
 * hears "כן", and says it is done — the booking already at its new time. Every
 * line is hers verbatim: the proposal and the confirmation are the sentences
 * `libi-tools` speaks, the stage is `libi-status`'s, and the button is the one
 * her card draws.
 *
 * **The words beside it are a heading and one paragraph.** A list of sample
 * sentences and a footnote under it used to share that column; the owner
 * asked for them to go, so the exchange is the section's picture and the
 * paragraph carries the one promise that matters — nothing already booked is
 * changed without asking.
 *
 * Static: the orb and the glow are CSS, so the page stays prerendered.
 * ---------------------------------------------------------------------------
 */

/** Something the owner said out loud. */
function Spoken({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "hero-badge flex w-fit max-w-full items-center gap-2.5 rounded-full py-1.5 ps-1.5 pe-4",
        className,
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white">
        <AudioLines className="size-3.5" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        «{children}»
      </span>
    </p>
  );
}

/** Something ליבי said — her card, as the app draws it. */
function Answer({
  children,
  confirm,
  booking,
}: {
  children: string;
  /** The change awaiting a yes, as her button reads. */
  confirm?: string;
  /** The booking where it now stands, when the answer is that it moved. */
  booking?: { name: string; time: string };
}) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <p className="text-[15px] leading-relaxed font-semibold text-zinc-900 dark:text-zinc-50">
        {children}
      </p>
      {confirm ? (
        <span className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white">
          <Check className="size-3.5" aria-hidden />
          {confirm}
        </span>
      ) : null}
      {booking ? (
        <div
          data-accent="violet"
          className="cal-glass mt-3 flex w-fit items-center gap-3 rounded-xl border px-3 py-2 text-zinc-900 dark:text-zinc-50"
        >
          <span className="text-sm font-bold">{booking.name}</span>
          {/* A span of two times: laid out left to right, or the RTL line
              draws the end time first — see `EntryCard`'s `span`. */}
          <span dir="ltr" className="text-xs tabular-nums opacity-75">
            {booking.time}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function LibiShowcase() {
  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid w-full max-w-[1400px] items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-3xl font-black tracking-tighter text-zinc-950 sm:text-4xl dark:text-zinc-50">
            מדברים עם היומן
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-pretty text-zinc-600 sm:text-lg dark:text-zinc-300">
            ליבי היא עוזרת קולית שמכירה את היומן שלכם. אומרים לה מה צריך —
            לקבוע, להזיז, להחליף או לבטל — והיא עושה את זה, בלי להקליד, בין לקוח
            ללקוח. תור שכבר נקבע היא לא משנה בלי לשאול קודם.
          </p>
        </div>

        {/* The exchange. `role="img"` with the whole conversation as its
            description: read aloud, the staggered pieces would lose who said
            what. */}
        <div
          role="img"
          aria-label="שיחה עם ליבי: בעל העסק אומר ״תזיזי את דנה לארבע״, ליבי בודקת ביומן ושואלת אם להזיז את התור של דנה לוי משתיים לארבע, בעל העסק עונה ״כן, בבקשה״, וליבי עונה שהתור הוזז לארבע"
          className="relative isolate overflow-hidden rounded-3xl px-5 pt-10 pb-24 sm:px-10"
        >
          <div
            aria-hidden
            className="hero-grid pointer-events-none absolute inset-0 -z-10"
          />
          {/* Her glow along the bottom edge, as it rises in the app. */}
          <div
            aria-hidden
            className="mock-voice-glow pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-56"
          />

          <div aria-hidden className="mx-auto flex max-w-md flex-col gap-4">
            <Spoken className="self-end">תזיזי את דנה לארבע</Spoken>

            <p className="flex items-center gap-2 text-violet-700 dark:text-violet-300">
              <MockOrb />
              <span className="libi-shimmer text-sm font-semibold">
                בודקת ביומן…
              </span>
            </p>

            <Answer confirm="הזזת דנה לוי מ-14:00 ל-16:00">
              מצאתי תור של דנה לוי היום ב-14:00. להזיז אותו להיום ב-16:00?
            </Answer>

            <Spoken className="self-end">כן, בבקשה</Spoken>

            <Answer booking={{ name: "דנה לוי", time: "16:00–16:30" }}>
              הזזתי את התור של דנה לוי ל-16:00.
            </Answer>
          </div>
        </div>
      </div>
    </section>
  );
}
