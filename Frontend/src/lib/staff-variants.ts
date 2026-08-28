/**
 * Telling two providers apart when they picked the same colour.
 *
 * ---------------------------------------------------------------------------
 * **The colour is chosen by the owner from a fixed set of seven, and nothing
 * stops two people picking the same one.** When they do, the calendar renders
 * both in the same glass and the same accent bar, and the grid quietly stops
 * answering the question the staff legend directly above it promises to answer:
 * whose booking is this. Nothing errors, and the owner's only clue is that two
 * cards look alike — which is exactly what they look like when it is one
 * person's two bookings.
 *
 * **A texture, not a hue.** The obvious fix is to shift the colour, and it is
 * the wrong one here for three reasons. `--cal-hue` feeds a `color-mix` that
 * `calendar-glass-contrast.test.ts` holds to AA on the composited surface, so
 * moving it means re-proving contrast for every generated shade. Deriving a
 * shade at runtime needs relative colour syntax (`oklch(from …)`), which the
 * five-year-old phone this product is opened on may not have. And a hue shift
 * small enough to still read as "the colour they chose" is a hue shift too
 * small to see, while one large enough to see is a different colour from the
 * one in the legend.
 *
 * A pattern costs none of that. It rides on top of whatever `bg-*` the swatch
 * already sets, is identical across all seven colours, survives colour
 * blindness — which a hue shift specifically does not — and touches no text and
 * no background that text sits on, so contrast is unchanged by construction.
 *
 * **Nobody who has a unique colour sees any of this.** Variant `0` is the
 * untouched solid bar, so a shop where everybody picked differently renders
 * exactly as it did. The texture appears only where there is a genuine
 * collision to resolve, which keeps it information rather than decoration.
 * ---------------------------------------------------------------------------
 */

/**
 * How many visually distinct treatments exist, counting the untouched solid as
 * one of them.
 *
 * Four, against seven colours: 28 providers can be told apart on sight. Past
 * that the treatments cycle and a pair can collide again — see
 * {@link staffVariants} for why that is a tolerable floor rather than a bug to
 * engineer around.
 */
export const STAFF_VARIANT_COUNT = 4;

/**
 * Each provider's treatment index within their own colour group.
 *
 * Keyed by staff id, positional within the group: the first holder of a colour
 * keeps the solid bar, the second gets the first texture, and so on. Order
 * comes from the roster, which is already total (`sortOrder, createdAt, id`),
 * so the same person keeps the same texture across days, views and reloads —
 * a texture that moved between refreshes would be worse than none.
 *
 * Cycles past {@link STAFF_VARIANT_COUNT}. A shop with five providers on one
 * colour has a repeat, and that is deliberately not solved here: the honest fix
 * for it is picking a different colour, the card still carries the person's
 * name, and inventing a fifth pattern that reads as "solid, but slightly" would
 * be a distinction the owner cannot actually use.
 */
export function staffVariants(
  team: readonly { id: string; color: string }[],
): Map<string, number> {
  const seen = new Map<string, number>();
  const variants = new Map<string, number>();

  for (const member of team) {
    const used = seen.get(member.color) ?? 0;
    variants.set(member.id, used % STAFF_VARIANT_COUNT);
    seen.set(member.color, used + 1);
  }

  return variants;
}

/**
 * The class that paints one treatment, or `null` for the solid default.
 *
 * The patterns themselves live in `globals.css` beside `.cal-glass`, for the
 * reason the whole calendar palette lives there: a `background-image` built
 * from a runtime value is a class Tailwind's scanner never emits.
 */
export function staffVariantClass(variant: number | undefined): string | null {
  if (!variant) return null;
  return `cal-dup-${((variant - 1) % (STAFF_VARIANT_COUNT - 1)) + 1}`;
}
