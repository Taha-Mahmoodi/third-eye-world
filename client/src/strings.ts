// Single source of truth for every spoken phrase in the app.
//
// Hard rule from INSTRUCTIONS.md § 2 #10: "No spoken phrase is inlined in
// code. Every spoken string lives in client/src/strings.ts. Single source of
// truth." This file is the contract. Audit subagents grep for new TTS calls
// or aria-live writes that bypass it.
//
// Tone rules (§ 12, third-eye-tone skill):
// - 1–2 short sentences, max 200 chars.
// - No lists, no markdown, no emojis, no parentheses.
// - Warm, calm, present-tense. Confirm, then optionally one next step.
// - Read aloud before adding. If it sounds robotic or repetitive, rewrite.
//
// Phase 1 ships only the phrases the record + play loop needs. Phase 2
// (voice commands) and Phase 4 (likes / comments) extend this file.

export const STRINGS = {
  RECORDING_STARTED: 'Recording. Press the button again to post.',
  RECORDING_APPROACHING_LIMIT: 'Ten seconds left.',
  RECORDING_POSTED: 'Posted.',
  RECORDING_FAILED: "I couldn't post that. Try again.",
  RECORDING_PERMISSION_DENIED: 'I need microphone access to record.',

  PLAYBACK_STARTING: 'Here are the latest memos.',
  PLAYBACK_NEXT: 'Next memo.',
  PLAYBACK_ALL_DONE: "That's everything for now.",
  PLAYBACK_ERROR: "Couldn't play that one. Skipping.",
  FEED_EMPTY: 'No memos yet. Try recording one.',
  FEED_LOAD_FAILED: "Couldn't load memos right now.",
} as const;

export type StringKey = keyof typeof STRINGS;
