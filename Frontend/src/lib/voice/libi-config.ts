/**
 * What Bazman Voice needs before it can hear anything.
 *
 * ---------------------------------------------------------------------------
 * **Server-only, enforced the way this codebase enforces it.** `OPENAI_API_KEY`
 * has no `NEXT_PUBLIC_` prefix, so a `"use client"` module importing this would
 * inline `undefined` and the feature would fail quietly — inviting somebody to
 * "fix" it by renaming the variable, which is the step that publishes a
 * billable key to every visitor. The guard is a runtime throw plus
 * `voice-isolation.test.ts`.
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
      "lib/voice/libi-config is server-only and must not be bundled",
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

/** Speech out. */
export const TTS_MODEL = "tts-1";

/** The voices OpenAI actually accepts. An unknown one is a 400 mid-turn. */
export const TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type TtsVoice = (typeof TTS_VOICES)[number];

export const DEFAULT_TTS_VOICE: TtsVoice = "nova";

/**
 * Which voice ליבי speaks in.
 *
 * `nova` by default — it reads Hebrew more naturally than the alternatives,
 * which is not a claim about the language so much as about how the others
 * handle its vowels. Overridable with `OPENAI_TTS_VOICE` because that is a
 * matter of taste that should not need a deploy of *code* to settle, and
 * because a shop may well disagree.
 *
 * **Validated rather than passed through.** An unrecognised value would reach
 * OpenAI and come back a 400, which surfaces to the owner as ליבי having
 * nothing to say — a typo in an environment variable turning into a mute
 * assistant. An unknown voice falls back to the default instead, which is the
 * same bargain every other coerced value in this codebase takes.
 */
export function ttsVoice(): TtsVoice {
  const configured = process.env.OPENAI_TTS_VOICE?.trim().toLowerCase();
  return TTS_VOICES.includes(configured as TtsVoice)
    ? (configured as TtsVoice)
    : DEFAULT_TTS_VOICE;
}

/* -------------------------------------------------------------------------- */
/* ElevenLabs — speech out, when it is configured                             */
/* -------------------------------------------------------------------------- */

/**
 * The two models worth pointing at Hebrew.
 *
 * `eleven_multilingual_v2` is the default and the better reader; `turbo_v2_5`
 * trades some of that for latency, which is a real consideration on a turn the
 * owner is standing still for. Configurable rather than chosen here because
 * which side of that trade a shop wants is not a code decision.
 */
export const ELEVENLABS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_turbo_v2_5",
] as const;

export type ElevenLabsModel = (typeof ELEVENLABS_MODELS)[number];

export const DEFAULT_ELEVENLABS_MODEL: ElevenLabsModel =
  "eleven_multilingual_v2";

export function elevenLabsModel(): ElevenLabsModel {
  const configured = process.env.ELEVENLABS_MODEL_ID?.trim();
  return ELEVENLABS_MODELS.includes(configured as ElevenLabsModel)
    ? (configured as ElevenLabsModel)
    : DEFAULT_ELEVENLABS_MODEL;
}

export type ElevenLabsConfig = {
  apiKey: string;
  voiceId: string;
  model: ElevenLabsModel;
};

/**
 * ElevenLabs, or null.
 *
 * ---------------------------------------------------------------------------
 * **Both halves or neither.** A key with no `ELEVENLABS_VOICE_ID` is not a
 * half-working configuration — the voice id is a *path segment*, so a request
 * without one is a 404 on every single turn. Treating that as "not configured"
 * sends the deploy back to OpenAI, which is a working assistant with a
 * different accent; treating it as configured would be a mute one.
 *
 * There is deliberately no default voice id. ElevenLabs publishes premade
 * voices with stable ids and it would be easy to hardcode one, but that would
 * mean a shop that set only the key silently speaks in a voice nobody here
 * chose, billed to their account. Absent is a clearer state than arbitrary.
 * ---------------------------------------------------------------------------
 */
export function elevenLabsConfig(): ElevenLabsConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;

  return { apiKey, voiceId, model: elevenLabsModel() };
}

export function isElevenLabsConfigured(): boolean {
  return elevenLabsConfig() !== null;
}

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
  /**
   * Still the OpenAI key, and only that one. ElevenLabs replaces the *speech
   * out* leg alone — Whisper still hears the question and `gpt-4o-mini` still
   * decides what it means, so an ElevenLabs key on its own is not an assistant.
   */
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
