/**
 * Calendar swatches for staff members.
 *
 * The same shape as `THEME_COLORS` in `branding.ts`, and for the same reason:
 * Tailwind cannot emit a class built from a runtime value, so a stored `#7c3aed`
 * would be a colour the agenda has no way to render. A fixed set of names lets
 * the stylesheet own what each one *looks* like while this module owns which
 * are *legal* — and lets a swatch be added without a migration.
 *
 * Classes are written out in full rather than interpolated, because Tailwind's
 * scanner reads source text: `bg-${name}-500` is never generated.
 */

export const STAFF_COLORS = [
  "slate",
  "rose",
  "amber",
  "emerald",
  "sky",
  "violet",
  "fuchsia",
] as const;

export type StaffColor = (typeof STAFF_COLORS)[number];

export const DEFAULT_STAFF_COLOR: StaffColor = "slate";

type Swatch = {
  /** Hebrew name, for the picker's accessible label. */
  label: string;
  /** A solid dot — the agenda's per-staff marker. */
  dot: string;
  /** A tinted chip, for a name badge that still carries readable text. */
  chip: string;
  /**
   * Sets `--cal-hue` on a calendar card, so the glass takes this person's
   * colour instead of the tenant's accent.
   *
   * A class rather than a colour for the reason the whole module exists —
   * Tailwind cannot emit an interpolated name — but also because the hue has to
   * resolve *at the element*, and only a real declaration does that. The values
   * live in `globals.css` beside `.cal-glass`; `calendar-glass-contrast.test.ts`
   * reads them from there and holds every one to AA on the composited surface.
   */
  tint: string;
};

/**
 * Every `chip` pairs a 100-level surface with an 800-level ink, which clears
 * WCAG AA on all seven without needing to be measured per swatch — the same
 * pairing `StatusChip` uses.
 */
export const STAFF_SWATCHES: Record<StaffColor, Swatch> = {
  slate: {
    label: "אפור",
    dot: "bg-slate-500",
    chip: "bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800",
    tint: "cal-staff-slate",
  },
  rose: {
    label: "ורוד",
    dot: "bg-rose-500",
    chip: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
    tint: "cal-staff-rose",
  },
  amber: {
    label: "כתום",
    dot: "bg-amber-500",
    chip: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    tint: "cal-staff-amber",
  },
  emerald: {
    label: "ירוק",
    dot: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
    tint: "cal-staff-emerald",
  },
  sky: {
    label: "תכלת",
    dot: "bg-sky-500",
    chip: "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900",
    tint: "cal-staff-sky",
  },
  violet: {
    label: "סגול",
    dot: "bg-violet-500",
    chip: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900",
    tint: "cal-staff-violet",
  },
  fuchsia: {
    label: "מג'נטה",
    dot: "bg-fuchsia-500",
    chip: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200 dark:bg-fuchsia-950 dark:text-fuchsia-200 dark:ring-fuchsia-900",
    tint: "cal-staff-fuchsia",
  },
};

/**
 * Validated on read, like every other owner-supplied column. A seed or a psql
 * session can write past the app, and the agenda has to render regardless.
 */
export function toStaffColor(value: string | null | undefined): StaffColor {
  return STAFF_COLORS.includes(value as StaffColor)
    ? (value as StaffColor)
    : DEFAULT_STAFF_COLOR;
}

export function staffSwatch(value: string | null | undefined): Swatch {
  return STAFF_SWATCHES[toStaffColor(value)];
}
