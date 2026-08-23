import { describe, expect, it } from "vitest";

import {
  isOnboardingPreset,
  ONBOARDING_PRESETS,
  PRESET_DEFINITIONS,
  PRESET_LIST,
  presetServices,
} from "@/lib/onboarding-presets";

/**
 * The starting points a new shop is offered (0026).
 *
 * Pure data, so these are cheap — but the two that matter are the fallback
 * (an absent or junk preset must still fill the form) and the copy guarantee
 * (`presetServices` hands back a copy, because the step edits the rows in
 * place and a shared array would leak one owner's edits into the next render).
 */

describe("the preset catalogue", () => {
  it("offers exactly the three trades, in order", () => {
    expect(PRESET_LIST.map((p) => p.id)).toEqual([
      "barbershop",
      "nails",
      "custom",
    ]);
  });

  it("gives every preset a label and a description", () => {
    for (const preset of PRESET_LIST) {
      expect(preset.label.trim()).not.toBe("");
      expect(preset.description.trim()).not.toBe("");
    }
  });

  it("carries the brief's services at the brief's durations", () => {
    expect(
      PRESET_DEFINITIONS.barbershop.services.map((s) => [
        s.name,
        s.durationMin,
      ]),
    ).toEqual([
      ["תספורת גבר", 30],
      ["עיצוב זקן", 20],
      ["תספורת ילד", 25],
    ]);

    expect(
      PRESET_DEFINITIONS.nails.services.map((s) => [s.name, s.durationMin]),
    ).toEqual([
      ["לק ג׳ל", 60],
      ["מניקור", 45],
      ["פדיקור", 60],
    ]);
  });

  it("prices every named service above zero", () => {
    // A ₪0 default reads as free on the booking page, which is a worse first
    // impression than a number the owner has to correct.
    for (const preset of PRESET_LIST) {
      for (const service of preset.services) {
        if (!service.name) continue;
        expect(service.priceCents).toBeGreaterThan(0);
      }
    }
  });

  it("gives every service a duration the step's own input accepts", () => {
    // The services step constrains minutes to 5–600; a preset outside that
    // would open the form in an invalid state.
    for (const preset of PRESET_LIST) {
      for (const service of preset.services) {
        expect(service.durationMin).toBeGreaterThanOrEqual(5);
        expect(service.durationMin).toBeLessThanOrEqual(600);
      }
    }
  });

  it("starts the blank preset with one empty row, not zero", () => {
    /**
     * "Blank" means the trade was not guessed, not that the owner faces an
     * empty screen — the services step has always opened with something to
     * edit, and a nameless row is where a service goes.
     */
    expect(PRESET_DEFINITIONS.custom.services).toHaveLength(1);
    expect(PRESET_DEFINITIONS.custom.services[0].name).toBe("");
  });

  it("ships no media on any preset yet", () => {
    /**
     * Pinned deliberately. `demo-nails` has no assets at all and
     * `demo-barber`'s live under its own tenant's storage path, so wiring
     * either would put one fabricated shop's premises on real booking pages.
     * When neutral `_presets/` assets exist this assertion is the thing that
     * should fail and be updated.
     */
    for (const preset of PRESET_LIST) {
      expect(preset.media.logoUrl).toBeNull();
      expect(preset.media.heroMediaUrl).toBeNull();
      expect(preset.media.heroMediaType).toBeNull();
      expect(preset.media.galleryUrls).toEqual([]);
    }
  });
});

describe("isOnboardingPreset", () => {
  it("accepts the three and nothing else", () => {
    for (const id of ONBOARDING_PRESETS)
      expect(isOnboardingPreset(id)).toBe(true);

    expect(isOnboardingPreset("barber")).toBe(false);
    expect(isOnboardingPreset("")).toBe(false);
    expect(isOnboardingPreset(null)).toBe(false);
    expect(isOnboardingPreset(undefined)).toBe(false);
  });
});

describe("presetServices", () => {
  it("returns the chosen trade's rows", () => {
    expect(presetServices("nails").map((s) => s.name)).toEqual([
      "לק ג׳ל",
      "מניקור",
      "פדיקור",
    ]);
  });

  it("falls back to the barbershop set for an absent or unknown preset", () => {
    /**
     * The set every shop saw before presets existed. A deep link straight to
     * `?step=services`, or a business row created before 0026, must not land
     * on an empty form.
     */
    const fallback = presetServices("barbershop").map((s) => s.name);

    expect(presetServices(null).map((s) => s.name)).toEqual(fallback);
    expect(presetServices(undefined).map((s) => s.name)).toEqual(fallback);
    expect(presetServices("nonsense").map((s) => s.name)).toEqual(fallback);
  });

  it("hands back a copy, so the step cannot mutate the catalogue", () => {
    // The services step edits its rows in place. Returning the shared objects
    // would carry one owner's typing into the next form that opened.
    const first = presetServices("barbershop");
    first[0].name = "משהו אחר";
    first[0].durationMin = 999;

    expect(presetServices("barbershop")[0].name).toBe("תספורת גבר");
    expect(PRESET_DEFINITIONS.barbershop.services[0].durationMin).toBe(30);
  });
});
