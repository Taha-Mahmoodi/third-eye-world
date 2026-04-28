// Command registry — single source of truth for what the app can do.
//
// Phase 2 task 4 per INSTRUCTIONS.md § 9. The actions below mirror the
// canonical list in .claude/skills/voice-grammar/SKILL.md exactly. Adding a
// new action here without updating that table is a fail at audit
// (voice-ux-specialist enforces this).
//
// The Phase 5 LLM tool list (server/src/llm/tools.ts) will mirror this enum.

import type { StringKey } from '../strings.js';

export const CommandAction = {
  RECORD_START: 'RECORD_START',
  RECORD_STOP_POST: 'RECORD_STOP_POST',
  NEXT_MEMO: 'NEXT_MEMO',
  PREVIOUS_MEMO: 'PREVIOUS_MEMO',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  LIKE: 'LIKE',
  UNLIKE: 'UNLIKE',
  COMMENT: 'COMMENT',
  STOP: 'STOP',
  HELP: 'HELP',
} as const;

export type CommandAction = (typeof CommandAction)[keyof typeof CommandAction];

/** The strings.ts confirmation key for each action.
 *  Source of truth for "every voice command has a spoken confirmation"
 *  (§ 2 #3 + voice-ux-specialist audit). */
export const COMMAND_CONFIRMATION: Record<CommandAction, StringKey> = {
  [CommandAction.RECORD_START]: 'RECORDING_STARTED',
  [CommandAction.RECORD_STOP_POST]: 'RECORDING_POSTED',
  [CommandAction.NEXT_MEMO]: 'PLAYBACK_NEXT',
  [CommandAction.PREVIOUS_MEMO]: 'PLAYBACK_PREVIOUS',
  [CommandAction.PAUSE]: 'PLAYBACK_PAUSED',
  [CommandAction.RESUME]: 'PLAYBACK_RESUMED',
  [CommandAction.LIKE]: 'LIKED',
  [CommandAction.UNLIKE]: 'UNLIKED',
  [CommandAction.COMMENT]: 'COMMENT_RECORDING',
  [CommandAction.STOP]: 'CANCELLED',
  [CommandAction.HELP]: 'HELP_LIST',
};
