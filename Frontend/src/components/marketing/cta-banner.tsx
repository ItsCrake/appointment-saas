import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BellRing,
  CalendarCheck,
  Clock3,
  Sparkles,
  Users,
} from "lucide-react";

/**
 * The closing moment. Deep brand gradient, a tech dot-matrix, a warm flare at
 * the base and a few glass tiles drifting around the copy.
 *
 * This *replaces* the old closing CTA rather than sitting next to it. Two
 * signup sections stacked at the bottom of a page is two asks, and the second
 * one reads as the first one not having worked.
 *
 * Every decorative layer is `aria-hidden` and `pointer-events-none`: none of
 * it carries meaning, and all of it sits over the region the buttons live in.
 */

/** Tilt, timing and position per tile. Hand-placed, not generated: they have
 *  to miss the headline at every width, which a loop cannot know. */
const TILES = [
  {
    icon: CalendarCheck,
    tilt: "-9deg",
    duration: "7.5s",
    delay: "0s",
    className: "start-[6%] top-[18%] hidden lg:flex",
  },
  {
    icon: BellRing,
    tilt: "7deg",
    duration: "8.5s",
    delay: "-1.2s",
    className: "end-[8%] top-[14%] hidden lg:flex",
  },
  {
    icon: Users,
    tilt: "-6deg",
    duration: "9s",
    delay: "-2.4s",
    className: "start-[11%] bottom-[16%] hidden xl:flex",
  },
  {
    icon: Clock3,
    tilt: "11deg",
    duration: "7.8s",
    delay: "-3.1s",
    className: "end-[12%] bottom-[20%] hidden lg:flex",
  },
  {
    icon: Sparkles,
    tilt: "-13deg",
    duration: "8.2s",
    delay: "-0.6s",
    className: "end-[22%] top-[46%] hidden xl:flex",
  },
] as const;

export function CtaBanner({
  signupLabel,
  demoLabel,
}: {
  signupLabel: string;
  demoLabel: string;
}) {
  return (
    <section className="px-4 pb-16 sm:px-8 sm:pb-24">
      <div className="relative mx-auto w-full max-w-[1400px] overflow-hidden rounded-[2rem] bg-[image:var(--brand-gradient-deep)] px-6 py-20 sm:rounded-[2.5rem] sm:px-10 sm:py-28">
        {/* Tech grid, faded out toward the bottom so it never competes with
            the flare sitting underneath it. */}
        <div
          aria-hidden
          className="dot-matrix pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_10%,transparent_85%)]"
        />

        {/* Warm flare at the base. The one warm note on the page, and the
            reason the panel reads as lit rather than as printed. */}
        <div
          aria-hidden
          className="cta-flare pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
        />

        {TILES.map(({ icon: Icon, tilt, duration, delay, className }, i) => (
          <span
            key={i}
            aria-hidden
            style={
              {
                "--tilt": tilt,
                "--float-duration": duration,
                "--float-delay": delay,
              } as CSSProperties
            }
            className={`animate-tile pointer-events-none absolute size-16 items-center justify-center rounded-3xl border border-white/25 bg-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_18px_40px_-18px_rgb(0_0_0/0.55)] backdrop-blur-md ${className}`}
          >
            <Icon className="size-7 text-white/80" strokeWidth={1.5} />
          </span>
        ))}

        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-black tracking-tighter text-white sm:text-5xl">
            היומן שלכם, מסודר מהיום
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-white/70">
            הקימו את עמוד ההזמנות שלכם ושתפו את הקישור עוד היום.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/dashboard/setup"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold whitespace-nowrap text-zinc-950 transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2a1a6b] focus-visible:outline-none active:translate-y-px sm:w-auto"
            >
              {signupLabel}
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
            <Link
              href="/demo-barber"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/40 px-8 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:border-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2a1a6b] focus-visible:outline-none active:translate-y-px sm:w-auto"
            >
              {demoLabel}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
