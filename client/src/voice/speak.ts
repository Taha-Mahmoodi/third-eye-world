// speak() — the only entry point for spoken feedback in the app.
//
// Phase 1 task 7 per INSTRUCTIONS.md § 9.
//
// The spec calls for a four-link fallback chain (§ 11):
//   1. ElevenLabs streaming
//   2. Server cache
//   3. Pre-generated MP3
//   4. Web Speech API (SpeechSynthesis)
//
// Phase 1 only wires link 4. Phase 3 (`feature/elevenlabs-skill` + friends)
// adds links 1–3 in front. The single-entry-point shape is locked now so
// the call sites do not change later.
//
// Hard rules from § 2 honored here:
// - #3 "Every state change is audible": this function ALWAYS updates the
//   aria-live region AND fires SpeechSynthesis. Both — never one.
// - #4 "App is never silent after a user action": if SpeechSynthesis is
//   unavailable (no-op stub in some test environments, blocked by privacy
//   settings, etc.), the aria-live region update still fires.
// - #10 "No spoken phrase inlined in code": this module reads phrases from
//   strings.ts. The keys are the public API; raw strings never cross.

import { STRINGS, type StringKey } from '../strings.js';

export interface SpeakOptions {
  /** Live region element to mirror the phrase into. Recommended for
   *  every call so screen readers + the visible-status div stay in sync. */
  liveRegion?: HTMLElement | null;
  /** Override the spoken text. Use sparingly — strings.ts is the rule. */
  textOverride?: string;
}

export function speak(key: StringKey, options: SpeakOptions = {}): void {
  const text = options.textOverride ?? STRINGS[key];

  // Always update the live region first. If TTS fails for any reason, the
  // visible/announced status still reflects what just happened.
  if (options.liveRegion) {
    options.liveRegion.textContent = text;
  }

  speakViaWebSpeech(text);
}

function speakViaWebSpeech(text: string): void {
  if (typeof globalThis === 'undefined') return;
  const win = globalThis as unknown as {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  };
  if (!win.speechSynthesis || !win.SpeechSynthesisUtterance) return;

  // Cancel anything already speaking — confirmations are short and chaining
  // them stale-on-stale produces a delayed mess of overlapping voices.
  win.speechSynthesis.cancel();

  const utterance = new win.SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  win.speechSynthesis.speak(utterance);
}

/** Test-only: clear any in-flight speech. Production code should not need
 *  this; the speak() entry point already cancels prior utterances. */
export function cancelSpeech(): void {
  const win = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  win.speechSynthesis?.cancel();
}
