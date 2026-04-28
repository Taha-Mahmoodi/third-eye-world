// speak() — the only entry point for spoken feedback in the app.
//
// Phase 3 task 4 per INSTRUCTIONS.md § 9 + the elevenlabs-integration skill.
//
// Four-link fallback chain (§ 11):
//   1. Pre-generated MP3   — /audio/phrases/<KEY>.mp3 (committed to repo)
//   2. Server proxy + cache — /api/tts?text=…  (server hits ElevenLabs)
//   3. (link 2 covers cache + ElevenLabs streaming as a single hop)
//   4. Web Speech API       — SpeechSynthesisUtterance
//
// Hard rules (§ 2):
// - #3 "Every state change is audible": speak() ALWAYS updates the
//   aria-live region SYNCHRONOUSLY, before any audio plays. Screen
//   readers announce the phrase even if the audio chain is slow or
//   fails entirely.
// - #4 "App is never silent after a user action": every link is wrapped
//   in try/catch — failure flows to the next link. Web Speech is the
//   floor; SpeechSynthesis presence is checked but assumed available.
// - #10 "No spoken phrase inlined in code": this module reads from
//   strings.ts. Callers pass StringKey values, never literals
//   (textOverride is the controlled escape hatch for dynamic phrases).

import { STRINGS, type StringKey } from '../strings.js';

export interface SpeakOptions {
  /** Live region element to mirror the phrase into. Recommended for
   *  every call so screen readers + the visible-status div stay in sync. */
  liveRegion?: HTMLElement | null;
  /** Override the spoken text. Use only for dynamic phrases (e.g. memo
   *  announcements with a user's name). The pre-baked link is skipped
   *  when this is set. */
  textOverride?: string;
  /** Override the voice path entirely — used by the voice-selection
   *  test page. When set, the chain becomes only "this URL → Web Speech". */
  audioUrl?: string;
}

export interface SpeakChainOptions {
  /** Override fetch — used by tests. */
  fetchImpl?: typeof fetch;
  /** Override Audio constructor — used by tests. */
  audioConstructor?: typeof HTMLAudioElement;
}

let chainOverrides: SpeakChainOptions = {};

/** Test seam — replace fetch / Audio to simulate the chain. */
export function _setSpeakOverrides(overrides: SpeakChainOptions): void {
  chainOverrides = overrides;
}

export function _resetSpeakOverrides(): void {
  chainOverrides = {};
}

export function speak(key: StringKey, options: SpeakOptions = {}): void {
  const text = options.textOverride ?? STRINGS[key];
  const phraseKey = options.textOverride ? null : key;

  // Always update the live region first. Screen reader announces this
  // regardless of audio outcome (§ 2 #3, #4).
  if (options.liveRegion) {
    options.liveRegion.textContent = text;
  }

  // Fire-and-forget the audio chain. Errors inside playSpeechChain are
  // already handled by falling through to the next link.
  void playSpeechChain(text, phraseKey, options.audioUrl);
}

async function playSpeechChain(
  text: string,
  phraseKey: StringKey | null,
  audioUrl: string | undefined,
): Promise<void> {
  // Direct URL override (voice-selection test page) — try only that URL,
  // then fall through to Web Speech if it fails.
  if (audioUrl) {
    if (await tryPlayUrl(audioUrl)) return;
    speakViaWebSpeech(text);
    return;
  }

  // Link 1: pre-generated MP3 (only for static phrases).
  if (phraseKey) {
    const url = `/audio/phrases/${phraseKey}.mp3`;
    if (await tryPlayUrl(url)) return;
  }

  // Link 2: server proxy + cache + ElevenLabs streaming.
  const serverUrl = `/api/tts?text=${encodeURIComponent(text)}`;
  if (await tryPlayUrl(serverUrl)) return;

  // Link 3 (Web Speech): always reachable in supported browsers.
  speakViaWebSpeech(text);
}

async function tryPlayUrl(url: string): Promise<boolean> {
  const fetchImpl = chainOverrides.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return false;

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET' });
  } catch {
    return false;
  }
  if (!response.ok) return false;

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return false;
  }
  if (blob.size === 0) return false;

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await playObjectUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function playObjectUrl(url: string): Promise<boolean> {
  const Ctor = chainOverrides.audioConstructor ?? globalThis.Audio;
  if (!Ctor) return false;
  return new Promise<boolean>((resolve) => {
    const audio = new Ctor(url);
    audio.addEventListener(
      'ended',
      () => {
        resolve(true);
      },
      { once: true },
    );
    audio.addEventListener(
      'error',
      () => {
        resolve(false);
      },
      { once: true },
    );
    audio.play().catch(() => {
      resolve(false);
    });
  });
}

function speakViaWebSpeech(text: string): void {
  if (typeof globalThis === 'undefined') return;
  const win = globalThis as unknown as {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  };
  if (!win.speechSynthesis || !win.SpeechSynthesisUtterance) return;

  win.speechSynthesis.cancel();

  const utterance = new win.SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  win.speechSynthesis.speak(utterance);
}

/** Test-only: clear any in-flight speech. Production code does not need
 *  this; the speak() entry point already cancels prior utterances. */
export function cancelSpeech(): void {
  const win = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  win.speechSynthesis?.cancel();
}
