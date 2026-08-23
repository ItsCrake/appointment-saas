"use client";

import type { CSSProperties } from "react";
import { ChevronLeft, Clock } from "lucide-react";

import type { ServiceLayout } from "@/lib/appearance";
import { formatDuration, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BookingService } from "./types";

type Props = {
  services: BookingService[];
  selectedId?: string;
  onSelect: (service: BookingService) => void;
  /**
   * Already resolved by the server — `resolveServiceLayout` has downgraded a
   * `showcase` shop with no pictures, so this component never has to ask
   * whether the layout it was handed is worth rendering.
   */
  layout?: ServiceLayout;
};

/**
 * The catalogue, in one of two shapes.
 *
 * ---------------------------------------------------------------------------
 * **`compact` is the default and stays the faster read.** One row per service,
 * the picture as an avatar, price and duration on the same line. A stranger
 * scanning six services on a phone gets all of them in one screen, and the
 * product's second principle — the client's minute is the budget — is why this
 * is not the showy one.
 *
 * **`showcase` exists because some shops sell the look.** A tattoo studio, a
 * nail salon, a colourist: the picture *is* the service description, and a row
 * of text throws away the only thing that was going to convince anybody. The
 * image carries the card and the text sits on a scrim over it.
 *
 * **The scrim is the whole reason blur appears here.** Text over a photograph
 * the tenant uploaded and nobody here has seen is the one problem backdrop
 * blur genuinely solves — it keeps the picture visible while the price stays
 * readable over a white studio wall or a black sleeve alike. It is not on the
 * compact rows, because there it would be decoration.
 * ---------------------------------------------------------------------------
 */
export function ServiceStep({
  services,
  selectedId,
  onSelect,
  layout = "compact",
}: Props) {
  return (
    <section aria-labelledby="service-heading" className="px-5">
      <h2
        id="service-heading"
        className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-100"
      >
        בחרו שירות
      </h2>
      <p className="mt-1 mb-5 text-xs text-zinc-500">
        {services.length} שירותים זמינים להזמנה
      </p>

      <ul
        className={cn(
          layout === "showcase"
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
            : "space-y-3",
        )}
      >
        {services.map((service, index) => (
          // Clamped, like every stagger on this page: a catalogue of thirty
          // services would otherwise still be arriving a second later.
          <li
            key={service.id}
            className="animate-rise"
            style={{ "--i": Math.min(index, 6) } as CSSProperties}
          >
            {layout === "showcase" ? (
              <ShowcaseCard
                service={service}
                selected={selectedId === service.id}
                onSelect={onSelect}
              />
            ) : (
              <CompactCard
                service={service}
                selected={selectedId === service.id}
                onSelect={onSelect}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type CardProps = {
  service: BookingService;
  selected: boolean;
  onSelect: (service: BookingService) => void;
};

/**
 * One row: avatar, name, description, duration and price.
 *
 * The surface comes from `.booking-card`, so the owner's card style and corner
 * setting reach it without this component knowing which one is on. The
 * transition list is explicit rather than `transition-all` and nothing
 * translates on hover — a card that moves is a moving target for the ~200ms
 * after a pointer lands on it, and a tap that registers as a hover first
 * arrives mid-flight.
 */
function CompactCard({ service, selected, onSelect }: CardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(service)}
      aria-pressed={selected}
      data-selected={selected}
      className={cn(
        "booking-card group flex w-full items-center gap-4 p-4 text-start",
        "active:scale-[0.99]",
        "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
      )}
    >
      {service.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
        <img
          src={service.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-16 shrink-0 object-cover ring-1 ring-zinc-900/5 ring-inset"
          style={{ borderRadius: "var(--radius-inner)" }}
        />
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
          {service.name}
        </span>

        {service.description ? (
          // Two lines rather than one: a service description is the only place
          // an owner explains what the client is buying.
          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-zinc-500">
            {service.description}
          </span>
        ) : null}

        <span className="mt-2.5 flex items-center gap-2">
          {/* Tinted, not filled: it is a duration, not an action, and a solid
              badge on every row would drown the selected state. */}
          <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-soft) px-2.5 py-1 text-[11px] font-medium text-(--accent-on-soft)">
            <Clock className="size-3" aria-hidden />
            {formatDuration(service.durationMin)}
          </span>
          <span className="text-[15px] font-bold tracking-[-0.01em] text-zinc-900 tabular-nums dark:text-zinc-100">
            {formatPrice(service.priceCents, service.currency)}
          </span>
        </span>
      </span>

      <ChevronLeft
        className="size-5 shrink-0 text-zinc-300 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-1 dark:text-zinc-600"
        aria-hidden
      />
    </button>
  );
}

/**
 * One image-led card, with the text on a scrim over it.
 *
 * **The gradient is a legibility guarantee, not a mood.** It runs from opaque
 * at the bottom — where the name and price sit — to nearly clear at the top,
 * so the photograph keeps the part worth seeing while white text keeps a wide
 * margin over AA against a pitch-black studio *and* a bright white wall.
 *
 * **The image scales on hover, the card does not.** One authored moment: the
 * picture is the content, so it is the thing that responds, and the card's own
 * geometry stays still under the cursor for the reason `CompactCard` explains.
 *
 * A service with no picture in a showcase grid falls back to the accent mesh
 * rather than a grey rectangle — degrade to something, never to nothing.
 */
function ShowcaseCard({ service, selected, onSelect }: CardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(service)}
      aria-pressed={selected}
      data-selected={selected}
      className={cn(
        "booking-card group relative block w-full overflow-hidden text-start",
        "aspect-[4/5] sm:aspect-[3/4]",
        "active:scale-[0.99]",
        "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
      )}
    >
      {service.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- per-tenant remote host, unknown at build time
        <img
          src={service.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
        />
      ) : (
        <span aria-hidden className="accent-mesh absolute inset-0 size-full" />
      )}

      {/* Bottom-weighted, and dark enough at the foot to hold white text over
          anything. Measured against the extremes rather than a mid-grey. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-zinc-950/88 via-zinc-950/45 to-zinc-950/5"
      />

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
        <span className="block text-[15px] leading-tight font-semibold tracking-[-0.01em] text-white">
          {service.name}
        </span>

        {service.description ? (
          <span className="line-clamp-2 block text-xs leading-relaxed text-white/75">
            {service.description}
          </span>
        ) : null}

        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-bold tracking-[-0.01em] text-white tabular-nums">
            {formatPrice(service.priceCents, service.currency)}
          </span>
          {/* The one blurred panel on the card. White-on-white-haze fails; a
              dark tinted pill over an unknown photograph does not. */}
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-950/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            <Clock className="size-3" aria-hidden />
            {formatDuration(service.durationMin)}
          </span>
        </span>
      </span>

      {/* Selection has to survive on a card that is already mostly image, so it
          is a filled accent bar rather than a ring the photograph would swallow. */}
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-(--accent)"
        />
      ) : null}
    </button>
  );
}
