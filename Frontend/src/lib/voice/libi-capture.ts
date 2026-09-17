/**
 * How ליבי opens the microphone, and what she asks the recorder for.
 *
 * ---------------------------------------------------------------------------
 * **Client-safe on purpose.** Nothing here touches a key, so the component may
 * import it — unlike `libi-config`, which `voice-isolation.test.ts` keeps out
 * of every browser bundle. The values live in a module rather than inline so
 * they are one place to read and one place a test can pin.
 *
 * **The browser's own voice processing, asked for by name.** Chrome happens to
 * enable echo cancellation, noise suppression and gain control by default for
 * `{ audio: true }`; other engines decide for themselves, and "happens to" is
 * not a setting. Stated explicitly, the clipper hum is attenuated *before* the
 * detector and the transcriber hear it, on every browser that can do it.
 * Mono, because a voice is one source and a second channel is only bytes.
 * ---------------------------------------------------------------------------
 */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

/**
 * The containers to record in, most preferred first.
 *
 * WebM/Opus is what Chromium records and the smallest of the three; MP4 is
 * Safari's; Ogg is last because `gpt-transcribe` does not list it — a browser
 * that can record nothing else still works, through the `whisper-1` fallback.
 */
export const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/**
 * The first container this browser can record, or `undefined` to let it pick.
 *
 * Takes the support check as an argument so it can be tested without a
 * `MediaRecorder`, and so a browser whose `isTypeSupported` throws is simply a
 * browser that picks for itself.
 */
export function pickRecorderMimeType(
  isSupported: ((type: string) => boolean) | undefined,
): string | undefined {
  if (!isSupported) return undefined;
  for (const type of RECORDER_MIME_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * 32kbps: transparent for a voice in Opus, and a five-second command is ~20KB
 * on the upload the owner waits through rather than the ~60KB a default
 * recorder chooses.
 */
export const RECORDER_BITS_PER_SECOND = 32_000;

/**
 * How long the recorder keeps going after the button is let go.
 *
 * People release on the last syllable — and in a Hebrew command the last
 * syllable is the name or the time. Half a second catches it without being a
 * wait anybody notices.
 */
export const RELEASE_TAIL_MS = 500;

/**
 * The backstops, now that silence is what normally ends a turn.
 *
 * A pressed turn may run longer — the owner chose to speak and may be dictating
 * something long. A turn that opened by itself gets less: a voice command is
 * a few seconds, and ten seconds of sound nobody paused in is far more likely
 * a radio than a request.
 */
export const MAX_PRESSED_TURN_MS = 15_000;
export const MAX_CONTINUED_TURN_MS = 10_000;

/**
 * How long the room one turn measured may seed the next.
 *
 * Within a conversation the room is the same room; an hour later it is not,
 * and a stale quiet estimate would let the new room's noise pass for a voice.
 */
export const ROOM_SEED_MAX_AGE_MS = 60_000;

/**
 * How many turns in a row may come back unheard before the conversation
 * closes itself.
 *
 * An empty transcript re-opens the microphone so the owner can simply say it
 * again; a room that produces nothing *but* empty transcripts must not keep
 * the microphone — and the transcription bill — running forever.
 */
export const MAX_UNHEARD_TURNS = 2;
