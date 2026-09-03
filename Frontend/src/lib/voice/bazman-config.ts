/**
 * What Bazman Voice needs before it can hear anything.
 *
 * ---------------------------------------------------------------------------
 * **Server-only, enforced the way this codebase enforces it.** `OPENAI_API_KEY`
 * has no `NEXT_PUBLIC_` prefix, so a `"use client"` module importing this would
 * inline `undefined` and the feature would fail quietly — inviting somebody to
 * "fix" it by renaming the variable, which is the step that publishes a
 * billable key to every visitor. The guard is a runtime throw plus
 * `bazman-isolation.test.ts`, mirroring `libi.ts` exactly.
 *
 * **A second provider, and that is a real cost worth naming.** This product
 * already talks to Anthropic for Libi. Whisper and TTS have no Anthropic
 * equivalent, so speech in and speech out have to come from somewhere else —
 * but the *middle* step, turning a Hebrew sentence into an intent, is the one
 * thing already solved here and already paid for. Routing it through
 * `gpt-4o-mini` is a deliberate instruction rather than a technical necessity;
 * `INTENT_MODEL` is the single line to change if that is revisited.
 * ---------------------------------------------------------------------------
 */
export function assertVoiceServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/voice/bazman-config is server-only and must not be bundled",
    );
  }
}

/** Speech in. The only OpenAI model here with no alternative. */
export const STT_MODEL = "whisper-1";

/**
 * Intent and tool selection.
 *
 * Small on purpose: the work is picking one of a handful of tools from a short
 * Hebrew sentence, with the appointment data supplied rather than recalled. A
 * larger model would be slower on a turn the owner is waiting through.
 */
export const INTENT_MODEL = "gpt-4o-mini";

/** Speech out. `nova` reads Hebrew more naturally than `alloy` to my ear. */
export const TTS_MODEL = "tts-1";
export const TTS_VOICE = "nova";

/**
 * Whether the assistant can reach a model at all.
 *
 * The microphone is not rendered when this is false — the same rule Libi
 * follows, and the rest of the product follows for a channel with no provider.
 * A control that appears to work and does not is how trust in every other
 * control goes. There is deliberately no console fallback: a fake transcript
 * would either invent an appointment or refuse every sentence.
 */
export function isVoiceConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function voiceApiKey(): string {
  assertVoiceServer();
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

/** Uploads are capped before they are sent anywhere that charges by the minute. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/**
 * Accepted container types.
 *
 * `MediaRecorder` produces `audio/webm;codecs=opus` on Chrome and Android and
 * `audio/mp4` on Safari — the browser decides, not us, so both have to be
 * allowed. The parameter after the semicolon is stripped before comparison.
 */
export const ACCEPTED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-m4a",
] as const;

export function isAcceptedAudioType(value: string | undefined): boolean {
  if (!value) return false;
  const base = value.split(";")[0].trim().toLowerCase();
  return (ACCEPTED_AUDIO_TYPES as readonly string[]).includes(base);
}
