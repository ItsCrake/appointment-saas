/*
 * ONBOARDING PRESET (0026)
 *
 * ---------------------------------------------------------------------------
 * Which starting point an owner picked on the first screen of the wizard —
 * "מספרת גברים", "ציפורניים ויופי" or a blank page.
 *
 * **Stored rather than carried through the URL**, because the step that offers
 * the choice runs *before* the business row exists and the step that consumes
 * it runs two navigations later. `?preset=` bridges those two points exactly as
 * `?plan=` already does; this column is what survives a refresh, a back button,
 * or an owner who abandons the flow and returns tomorrow.
 *
 * **Nullable, and it stays that way.** Every business created before this
 * migration chose nothing, and `presetServices` reads an absent value as the
 * default set — which is precisely what those shops were shown at the time. A
 * `NOT NULL DEFAULT` would have invented a decision on their behalf.
 *
 * **Text, not an enum.** The values are a product decision that will churn —
 * a barber, a nail studio, and whatever the next ten pilot shops turn out to
 * be — and every one of those changes would otherwise be a migration to add an
 * enum label. `isOnboardingPreset` validates on the way in, and an unrecognised
 * value degrades to the default set rather than failing.
 *
 * Nothing branches on this column. It seeds the editable defaults of a form and
 * is then only useful for asking which presets actually convert.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "onboarding_preset" text;
