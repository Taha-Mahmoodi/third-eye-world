// Command parser — utterance → CommandAction.
//
// Phase 2 task 4 per INSTRUCTIONS.md § 9. The mapping below is compiled
// from .claude/skills/voice-grammar/SKILL.md. Update both together.
//
// Matching algorithm (per the voice-grammar skill):
// 1. Exact match on the normalized transcript (lowercased, trimmed,
//    trailing punctuation stripped).
// 2. Exact match after stripping leading filler ("um", "uh", "okay", ...).
// 3. Whole-word containment, longest phrase wins. "next memo" beats
//    "next" so an utterance like "go to next memo" still resolves the
//    same way. Same-action collisions (e.g. "next" and "next memo" both
//    map to NEXT_MEMO) are fine.
// 4. Otherwise null — the dispatcher speaks STRINGS.UNKNOWN_COMMAND so
//    the user is never silently ignored (§ 2 #4).

import { CommandAction } from './registry.js';

/** Map from utterance phrase → action. Phrases live lowercased here. */
const COMMAND_MAP: ReadonlyMap<string, CommandAction> = new Map([
  // RECORD_START
  ['record', CommandAction.RECORD_START],
  ['start', CommandAction.RECORD_START],
  ['post a memo', CommandAction.RECORD_START],
  ['new memo', CommandAction.RECORD_START],

  // RECORD_STOP_POST
  ['post', CommandAction.RECORD_STOP_POST],
  ['send', CommandAction.RECORD_STOP_POST],
  ['share', CommandAction.RECORD_STOP_POST],
  ['done', CommandAction.RECORD_STOP_POST],

  // NEXT_MEMO
  ['next', CommandAction.NEXT_MEMO],
  ['skip', CommandAction.NEXT_MEMO],
  ['next memo', CommandAction.NEXT_MEMO],

  // PREVIOUS_MEMO
  ['previous', CommandAction.PREVIOUS_MEMO],
  ['back', CommandAction.PREVIOUS_MEMO],
  ['go back', CommandAction.PREVIOUS_MEMO],
  ['previous memo', CommandAction.PREVIOUS_MEMO],

  // PAUSE
  ['pause', CommandAction.PAUSE],
  ['wait', CommandAction.PAUSE],
  ['hold on', CommandAction.PAUSE],

  // RESUME
  ['resume', CommandAction.RESUME],
  ['play', CommandAction.RESUME],
  ['continue', CommandAction.RESUME],

  // LIKE
  ['like', CommandAction.LIKE],
  ['heart', CommandAction.LIKE],
  ['love this', CommandAction.LIKE],
  ['love it', CommandAction.LIKE],

  // UNLIKE — keep BEFORE LIKE in the longest-wins sort but the Map preserves
  // insertion order; the actual disambiguation happens in PHRASES_BY_LENGTH.
  ['unlike', CommandAction.UNLIKE],
  ['remove like', CommandAction.UNLIKE],
  ['unlike this', CommandAction.UNLIKE],

  // COMMENT
  ['comment', CommandAction.COMMENT],
  ['reply', CommandAction.COMMENT],
  ['respond', CommandAction.COMMENT],

  // STOP
  ['stop', CommandAction.STOP],
  ['cancel', CommandAction.STOP],
  ['never mind', CommandAction.STOP],

  // HELP
  ['help', CommandAction.HELP],
  ['what can i say', CommandAction.HELP],
  ['commands', CommandAction.HELP],
  ['what now', CommandAction.HELP],
]);

const FILLER_PREFIXES = ['uh', 'um', 'okay', 'ok', 'so', 'hey', 'please'];

/** Phrases sorted longest-first, for word-boundary substring matching. */
const PHRASES_BY_LENGTH: ReadonlyArray<readonly [string, CommandAction]> = [
  ...COMMAND_MAP.entries(),
].sort((a, b) => b[0].length - a[0].length);

function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

function stripFiller(text: string): string {
  let out = text;
  for (const filler of FILLER_PREFIXES) {
    const re = new RegExp(`^${filler}[,.\\s]+`, 'i');
    out = out.replace(re, '');
  }
  return out;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseCommand(transcript: string | null | undefined): CommandAction | null {
  if (!transcript) return null;

  const normalized = normalize(transcript);
  if (!normalized) return null;

  // 1. Exact match on the normalized transcript.
  const exact = COMMAND_MAP.get(normalized);
  if (exact) return exact;

  // 2. Strip leading filler ("um, like" → "like") and try exact again.
  const stripped = stripFiller(normalized);
  if (stripped !== normalized) {
    const afterStrip = COMMAND_MAP.get(stripped);
    if (afterStrip) return afterStrip;
  }

  // 3. Whole-word containment, longest phrase wins.
  const haystack = stripped !== normalized ? stripped : normalized;
  for (const [phrase, action] of PHRASES_BY_LENGTH) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`);
    if (re.test(haystack)) return action;
  }

  return null;
}

/** Test seam: read the canonical phrase list. */
export function _getRegisteredPhrases(): ReadonlyArray<readonly [string, CommandAction]> {
  return PHRASES_BY_LENGTH;
}
