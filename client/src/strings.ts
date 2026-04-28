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
// Phase 1 added the record + play phrases. Phase 2 adds the rest of the v1
// command set (per .claude/skills/voice-grammar/SKILL.md) — every Confirmation
// key in that table maps to an entry below. Phase 4 (likes / comments) wires
// those entries up to real backend actions, but the phrases ship now.

export const STRINGS = {
  // Recording
  RECORDING_STARTED: 'Recording. Press the button again to post.',
  RECORDING_APPROACHING_LIMIT: 'Ten seconds left.',
  RECORDING_POSTED: 'Posted.',
  RECORDING_FAILED: "I couldn't post that. Try again.",
  RECORDING_PERMISSION_DENIED: 'I need microphone access to record.',

  // Playback / feed
  PLAYBACK_STARTING: 'Here are the latest memos.',
  PLAYBACK_NEXT: 'Next memo.',
  PLAYBACK_PREVIOUS: 'Previous memo.',
  PLAYBACK_PAUSED: 'Paused.',
  PLAYBACK_RESUMED: 'Playing.',
  PLAYBACK_ALL_DONE: "That's everything for now.",
  PLAYBACK_ERROR: "Couldn't play that one. Skipping.",
  FEED_EMPTY: 'No memos yet. Try recording one.',
  FEED_LOAD_FAILED: "Couldn't load memos right now.",

  // Likes (Phase 4 wires the backend; phrase ships now)
  LIKED: 'Liked.',
  UNLIKED: 'Unliked.',

  // Comments (Phase 4)
  COMMENT_RECORDING: 'Go ahead. Press the button again to send your reply.',
  COMMENT_POSTED: 'Replied.',
  COMMENT_FAILED: "I couldn't send that reply. Try again.",
  NO_MEMO_TO_REPLY_TO: "Nothing to reply to right now. Say next or record.",
  // Replies announcement (Phase 4 task 5). {count} is substituted at the
  // call site — this template is the only place the wording lives. The
  // brace placeholder avoids the markdown-emphasis regex in the tone-
  // contract test that flags underscores.
  REPLIES_ANNOUNCEMENT_ONE: 'This memo has 1 reply.',
  REPLIES_ANNOUNCEMENT_MANY: 'This memo has {count} replies.',

  // Control
  CANCELLED: 'Cancelled.',
  UNKNOWN_COMMAND: "I didn't catch that. Say help to hear what you can say.",

  // Help
  HELP_LIST:
    'Try record, post, next, like, comment, or stop. Say help any time to hear this again.',

  // Phase 5 task 7 — LLM degraded mode (§ 18). Fired when /api/llm was
  // attempted and failed AND the deterministic parser also could not
  // resolve the transcript. Distinct from UNKNOWN_COMMAND so a real
  // backend outage gets a contextual message, not a generic
  // "say help" prompt.
  DEGRADED_MODE:
    "I'm having trouble understanding right now. Try saying next, like, or comment.",
} as const;

export type StringKey = keyof typeof STRINGS;
