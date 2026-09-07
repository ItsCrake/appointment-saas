/**
 * Which Hebrew forms ליבי uses when she addresses the owner.
 *
 * ---------------------------------------------------------------------------
 * **Hebrew has no neutral second person, so this is not a nicety.** "Would you
 * like me to update it" is either תרצה or תרצי; there is no third option, and
 * whichever the product picks unasked is wrong for about half the shops it runs
 * in — every turn, out loud, in front of whoever is in the chair.
 *
 * Coerced rather than trusted, exactly like the ElevenLabs model id: the value
 * comes from a settings form and a database column that has held a default
 * since 0033, and a typo must produce the default rather than a prompt
 * instructing the model in a gender that does not exist.
 *
 * **Its own module, and not `libi-config`, because nothing here is a secret.**
 * That module reads `OPENAI_API_KEY` and `voice-isolation.test.ts` forbids a
 * client component from importing it at all — a rule worth keeping literal,
 * since a type-only import is erased at build time but still teaches the next
 * reader that the import is fine. The settings form needs these three names
 * and no key, so they live somewhere a browser bundle may go.
 * ---------------------------------------------------------------------------
 */
export const ADDRESS_GENDERS = ["male", "female"] as const;

export type AddressGender = (typeof ADDRESS_GENDERS)[number];

export const DEFAULT_ADDRESS_GENDER: AddressGender = "male";

export function addressGender(value: string | null | undefined): AddressGender {
  const wanted = value?.trim().toLowerCase();
  return (ADDRESS_GENDERS as readonly string[]).includes(wanted ?? "")
    ? (wanted as AddressGender)
    : DEFAULT_ADDRESS_GENDER;
}
