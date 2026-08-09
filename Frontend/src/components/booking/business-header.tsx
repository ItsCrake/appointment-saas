import { MapPin, Phone } from "lucide-react";

import type { HeroMediaType } from "@/lib/branding";
import type { SocialLink } from "@/lib/social-links";
import { cn } from "@/lib/utils";

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
       */}
      <div className="accent-mesh relative aspect-[4/3] max-h-[26rem] w-full overflow-hidden sm:aspect-[16/9]">
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

        {/* Fades to the page background so the banner ends without a seam, and
            keeps the logo readable over an arbitrary photo. Lighter over the
            mesh, which is already dark and does not need holding down. */}
        <div
          aria-hidden
          className={cn(
            "absolute inset-0",
            hasHero
              ? "bg-gradient-to-b from-black/10 via-black/25 to-white dark:to-zinc-950"
              : "bg-gradient-to-b from-transparent via-transparent to-white dark:to-zinc-950",
          )}
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
            className="mx-auto mb-4 size-20 rounded-full object-cover ring-4 ring-white dark:ring-zinc-950"
          />
        ) : (
          // The monogram now carries the tenant's accent rather than ink. It
          // is the fallback most shops will actually ship with, so it is worth
          // it looking like their brand and not like a missing asset.
          <div
            aria-hidden
            className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-(--accent) text-2xl font-bold text-(--accent-contrast) shadow-sm ring-4 ring-white dark:ring-zinc-950"
          >
            {name.trim().charAt(0)}
          </div>
        )}

        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {name}
        </h1>

        {description ? (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {description}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-zinc-500">
          {address ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {address}
            </span>
          ) : null}

          {phone ? (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
