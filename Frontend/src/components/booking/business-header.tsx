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
    <header className={cn("pb-6", !hasHero && "pt-8")}>
      {hasHero ? (
        <div className="relative h-44 w-full overflow-hidden sm:h-56">
          {heroMediaType === "video" ? (
            <video
              src={heroMediaUrl!}
              autoPlay
              muted
              loop
              playsInline
              // Decorative: it carries no information the page does not already
              // state in text, so it is hidden from assistive tech.
              aria-hidden
              tabIndex={-1}
              className="size-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
            <img
              src={heroMediaUrl!}
              alt=""
              className="size-full object-cover"
            />
          )}

          {/* Fades to the page background so the banner ends without a seam,
              and keeps the logo readable over an arbitrary photo. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-white dark:to-zinc-950"
          />
        </div>
      ) : null}

      <div
        className={cn(
          "px-5 text-center",
          // Pull the logo up to straddle the banner edge when there is one.
          hasHero && "relative -mt-12",
        )}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote host is per-tenant and not known at build time
          <img
            src={logoUrl}
            alt=""
            className={cn(
              "mx-auto mb-4 size-20 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10",
              hasHero && "ring-4 ring-white dark:ring-zinc-950",
            )}
          />
        ) : (
          <div
            aria-hidden
            className={cn(
              "mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 text-2xl font-bold text-white shadow-sm dark:from-zinc-100 dark:to-zinc-300 dark:text-zinc-900",
              hasHero && "ring-4 ring-white dark:ring-zinc-950",
            )}
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
