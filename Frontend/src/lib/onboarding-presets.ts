/**
 * Starting points for a new shop (0026).
 *
 * ---------------------------------------------------------------------------
 * **A preset is a set of defaults, not a mode.** Nothing downstream branches on
 * which one was chosen: it seeds the editable values a step opens with, and
 * from that moment the owner's edits are the only thing that matters. There is
 * no "barbershop behaviour" anywhere in the product, and adding one later would
 * be a different feature with a much worse blast radius.
 *
 * That is also why this module is pure data with no imports. The wizard already
 * persists every step to the database as it goes — see `setup/actions.ts` — so
 * the preset's whole job is to answer "what should this form say before the
 * owner touches it", which is a question with no side effects.
 *
 * **The choice is remembered on the business row** rather than carried through
 * the URL, because the step that offers it runs *before* the business exists
 * and the step that consumes it runs two navigations later. `?preset=` is the
 * one-shot hint between those two points, exactly as `?plan=` already works;
 * `onboarding_preset` is what survives a refresh.
 * ---------------------------------------------------------------------------
 */

export const ONBOARDING_PRESETS = ["barbershop", "nails", "custom"] as const;

export type OnboardingPreset = (typeof ONBOARDING_PRESETS)[number];

export function isOnboardingPreset(
  value: string | null | undefined,
): value is OnboardingPreset {
  return (
    typeof value === "string" &&
    (ONBOARDING_PRESETS as readonly string[]).includes(value)
  );
}

/** One row of the services step, before the owner edits it. */
export type PresetService = {
  name: string;
  durationMin: number;
  /** Agorot, as the column stores it. */
  priceCents: number;
};

export type PresetDefinition = {
  id: OnboardingPreset;
  /** The card's title. */
  label: string;
  /** One line under it — what this shop is, in the owner's own words. */
  description: string;
  services: PresetService[];
  /**
   * Images and video the shop opens with.
   *
   * **Deliberately empty on every preset today.** The intent is to hand a new
   * shop a page that already looks finished, and the assets to do that do not
   * exist yet: `demo-nails` has no media at all, and `demo-barber`'s live under
   * its own tenant's storage path — pointing real shops at those would show one
   * fabricated business's premises on every barbershop's booking page, and
   * break them all if that tenant's files were ever cleared.
   *
   * The field is here rather than added later because it is the shape the
   * feature was designed around: when neutral placeholder assets exist under a
   * shared `_presets/` path, populating these three is the whole change and
   * `setup-media-step` is the only new surface needed.
   */
  media: {
    logoUrl: string | null;
    heroMediaUrl: string | null;
    heroMediaType: "image" | "video" | null;
    galleryUrls: string[];
  };
};

/**
 * Durations come from the pilot brief; prices are anchored to what the two demo
 * tenants actually charge in `db/seed.ts`, so an owner sees a plausible number
 * rather than a round guess. Every one of them is editable on the same screen
 * it appears on — these are a starting point, not a price list.
 */
const EMPTY_MEDIA: PresetDefinition["media"] = {
  logoUrl: null,
  heroMediaUrl: null,
  heroMediaType: null,
  galleryUrls: [],
};

export const PRESET_DEFINITIONS: Record<OnboardingPreset, PresetDefinition> = {
  barbershop: {
    id: "barbershop",
    label: "מספרת גברים",
    description: "תספורות, עיצוב זקן וטיפוח",
    services: [
      { name: "תספורת גבר", durationMin: 30, priceCents: 7000 },
      { name: "עיצוב זקן", durationMin: 20, priceCents: 3000 },
      { name: "תספורת ילד", durationMin: 25, priceCents: 6000 },
    ],
    media: EMPTY_MEDIA,
  },
  nails: {
    id: "nails",
    label: "ציפורניים ויופי",
    description: "לק ג׳ל, מניקור ופדיקור",
    services: [
      { name: "לק ג׳ל", durationMin: 60, priceCents: 12000 },
      { name: "מניקור", durationMin: 45, priceCents: 8000 },
      { name: "פדיקור", durationMin: 60, priceCents: 15000 },
    ],
    media: EMPTY_MEDIA,
  },
  /**
   * One blank row, not zero.
   *
   * "Blank" means "we have not guessed your trade", not "here is an empty
   * screen and good luck" — the services step has always opened with something
   * to edit, and an owner who picked this option still has to be shown where a
   * service goes. The row carries the same 30-minute default the step's own
   * "add another" button uses.
   */
  custom: {
    id: "custom",
    label: "עסק מותאם אישית",
    description: "מתחילים מדף ריק",
    services: [{ name: "", durationMin: 30, priceCents: 5000 }],
    media: EMPTY_MEDIA,
  },
};

/** The cards, in the order they are offered. */
export const PRESET_LIST: PresetDefinition[] = ONBOARDING_PRESETS.map(
  (id) => PRESET_DEFINITIONS[id],
);

/**
 * What the services step should open with.
 *
 * Falls back to the barbershop set for an unknown or absent preset, which is
 * what every shop got before this existed — a deep link straight to
 * `?step=services` must not produce an empty screen.
 */
export function presetServices(
  preset: string | null | undefined,
): PresetService[] {
  const definition = isOnboardingPreset(preset)
    ? PRESET_DEFINITIONS[preset]
    : PRESET_DEFINITIONS.barbershop;

  // Copied, because the step edits these rows in place.
  return definition.services.map((service) => ({ ...service }));
}
