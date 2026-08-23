import { MapPin, Phone } from "lucide-react";

import type { HeroMediaType } from "@/lib/branding";
import type { SocialLink } from "@/lib/social-links";

import { HoursDrawer } from "./hours-drawer";
import { SocialRow } from "./social-row";
import type { BookingHours } from "./types";

type Props = {
  name: string;
  description: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  /** Already parsed and validated; an empty array renders nothing. */
  socialLinks: SocialLink[];
  hours: BookingHours[];
  /** 0 = Sunday, resolved in the business timezone by the server. */
  todayWeekday: number;
  heroMediaUrl: string | null;
  heroMediaType: HeroMediaType | null;
};

/**
 * Server component: nothing here is interactive except the hours sheet, which
 * is the only part that ships JavaScript. The hero video is declarative markup,
 * so it needs no client boundary either.
 */
export function BusinessHeader({
  name,
  description,
  logoUrl,
  address,
  phone,
  socialLinks,
  hours,
  todayWeekday,
  heroMediaUrl,
  heroMediaType,
}: Props) {
  const hasHero = Boolean(heroMediaUrl && heroMediaType);

  return (
    <header className="pb-6">
      {/**
       * The banner renders for **every** business, media or not.
       *
       * It used to appear only when a hero had been uploaded, so a shop that
       * had not got round to it opened as a white page with a grey monogram —
       * the most important screen in the product introducing them as nothing in
       * particular. With no media the mesh takes over in the colour they chose,
       * which is the one branding decision every tenant has actually made.
       *
       * Sized by aspect ratio rather than a fixed height, so it holds the same
       * proportion of a phone and of a laptop. The cap stops a tablet turning it
       * into a full screen of decoration before anyone reaches a service.
       *
       * Rounded on the bottom edge only. The page is a `max-w-lg` column, so on
       * a phone this is full-bleed and the curve reads as the top card of an app
       * rather than as a picture that ran out; on a laptop the column is 512px
       * and a square bottom edge would read as an unfinished crop.
       */}
      <div
        className="accent-mesh relative aspect-[4/3] max-h-[26rem] w-full overflow-hidden sm:aspect-[16/9]"
        // The banner's curve follows the owner's corner setting with everything
        // else, so a shop on the tightest geometry does not get a soft banner
        // over sharp cards.
        style={{
          borderBottomLeftRadius: "var(--radius-hero)",
          borderBottomRightRadius: "var(--radius-hero)",
        }}
      >
        {hasHero && heroMediaType === "video" ? (
          <video
            src={heroMediaUrl!}
            autoPlay
            muted
            loop
            playsInline
            // The clip is a background, not a player: no controls, no picture
            // in picture, and nothing for a long-press to offer.
            controls={false}
            disablePictureInPicture
            // Decorative: it carries no information the page does not already
            // state in text, so it is hidden from assistive tech.
            aria-hidden
            tabIndex={-1}
            className="size-full object-cover"
          />
        ) : hasHero ? (
          // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
          <img src={heroMediaUrl!} alt="" className="size-full object-cover" />
        ) : (
          // No media: the mesh is the banner, with the same dot texture the
          // marketing page uses so the two feel like one product.
          <div
            aria-hidden
            className="dot-matrix absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_0%,transparent_75%)]"
          />
        )}

        {/**
         * Two layers, because they answer two different questions (0027).
         *
         * The **scrim** is the owner's `hero_overlay`: how hard the photograph
         * darkens under the logo and the name. It is adjustable because the
         * right answer depends on the picture — a bright shopfront and a dark
         * studio need different values, and no fixed number serves both. Only
         * over real media; the mesh is already dark and holding it down twice
         * just makes it muddy.
         *
         * The **seam fade** is structural and never adjustable. It carries the
         * banner into the page background so the bottom edge does not cut, and
         * an owner who set the scrim to 0 must still not get a hard line across
         * their page.
         */}
        {hasHero ? (
          <div aria-hidden className="hero-scrim absolute inset-0" />
        ) : null}

        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white dark:to-zinc-950"
        />
      </div>

      {/* Pulled up to straddle the banner edge — now always, since the banner
          is always there. */}
      <div className="relative -mt-12 px-5 text-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote host is per-tenant and not known at build time
          <img
            src={logoUrl}
            alt=""
            className="shadow-float mx-auto mb-4 size-24 rounded-full object-cover ring-4 ring-white dark:ring-zinc-950"
          />
        ) : (
          // The monogram now carries the tenant's accent rather than ink. It
          // is the fallback most shops will actually ship with, so it is worth
          // it looking like their brand and not like a missing asset.
          <div
            aria-hidden
            className="shadow-accent mx-auto mb-4 flex size-24 items-center justify-center rounded-full bg-(--accent) text-3xl font-bold text-(--accent-contrast) ring-4 ring-white dark:ring-zinc-950"
          >
            {name.trim().charAt(0)}
          </div>
        )}

        {/* The one display-sized moment on the page. Everything below it is
            interface; this is the shop saying who they are, so it gets the
            tighter tracking a large size needs and `text-balance` so a
            two-word name never breaks to a lonely second line. */}
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-[-0.02em] text-balance text-zinc-900 sm:text-[2rem] dark:text-zinc-50">
          {name}
        </h1>

        {description ? (
          <p className="mx-auto mt-2.5 max-w-sm text-[15px] leading-relaxed text-pretty text-zinc-600 dark:text-zinc-400">
            {description}
          </p>
        ) : null}

        {/* One chip shape for all three, so the row reads as a set rather than
            as a sentence with two links in it. The address chip is not
            interactive and deliberately carries no hover state — same shape,
            different affordance, which is what keeps the two that *are*
            tappable honest. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
          {address ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100/80 px-3 py-1.5 ring-1 ring-zinc-900/5 ring-inset dark:bg-zinc-800/60 dark:ring-white/10">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {address}
            </span>
          ) : null}

          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100/80 px-3 py-1.5 font-medium ring-1 ring-zinc-900/5 transition-colors ring-inset hover:bg-zinc-200/80 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:bg-zinc-800/60 dark:ring-white/10 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
            >
              <Phone className="size-3.5 shrink-0" aria-hidden />
              <span dir="ltr">{phone}</span>
            </a>
          ) : null}

          <HoursDrawer hours={hours} todayWeekday={todayWeekday} />
        </div>

        {/* Under the contact row rather than beside it: these are the only
            outbound links on a page whose job is to keep someone here until
            they have booked, so they sit below the reasons to stay. */}
        <div className="flex justify-center">
          <SocialRow links={socialLinks} />
        </div>
      </div>
    </header>
  );
}
