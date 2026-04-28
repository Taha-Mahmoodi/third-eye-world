// Keyboard handler — maps keystrokes to CommandActions.
//
// Phase 2 task 5 per INSTRUCTIONS.md § 9.
//
// Hard rule § 2 #6: every voice command has a keyboard equivalent. The
// mapping below covers all 11 actions in the voice-grammar skill. The
// `voice-ux-specialist` subagent will block any new CommandAction that does
// not appear here.
//
// Space toggles pause/resume rather than mapping to one or the other —
// that's why this module is more than a static map.

import { CommandAction } from './registry.js';

export interface KeyboardOptions {
  /** Tells the handler whether playback is currently active, so Space
   *  can resolve to PAUSE (when playing) or RESUME (otherwise). */
  isPlaying: () => boolean;
  /** Optional override — return true to skip the handler entirely
   *  (e.g. when a modal's own keyboard handling is active). */
  shouldSkip?: (event: KeyboardEvent) => boolean;
}

/** Static key → action map (everything except Space, which toggles). */
type KeyRule = { match: (event: KeyboardEvent) => boolean; action: CommandAction };
const STATIC_RULES: ReadonlyArray<KeyRule> = [
  // RECORD_START — "r" with no modifiers (Shift+R is reserved for future
  // expansion; the lowercase form is what we ship).
  {
    match: (e) => e.key === 'r' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.RECORD_START,
  },

  // RECORD_STOP_POST — Enter (with no modifiers; Shift+Enter is reserved).
  {
    match: (e) => e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.RECORD_STOP_POST,
  },

  // NEXT_MEMO — Right arrow.
  {
    match: (e) => e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.NEXT_MEMO,
  },

  // PREVIOUS_MEMO — Left arrow.
  {
    match: (e) => e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.PREVIOUS_MEMO,
  },

  // LIKE — lowercase l (no Shift).
  {
    match: (e) => e.key === 'l' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.LIKE,
  },

  // UNLIKE — uppercase L (Shift+L). Browsers report the uppercase form
  // when Shift is held, so we match on the literal "L" + the shift flag.
  {
    match: (e) => e.key === 'L' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.UNLIKE,
  },

  // COMMENT — c.
  {
    match: (e) => e.key === 'c' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey,
    action: CommandAction.COMMENT,
  },

  // STOP — Escape (no modifiers needed; Esc is universal).
  {
    match: (e) => e.key === 'Escape',
    action: CommandAction.STOP,
  },

  // HELP — "?" (Shift+/ on US keyboards; we just match the literal char).
  {
    match: (e) => e.key === '?',
    action: CommandAction.HELP,
  },
];

export function keyToAction(
  event: KeyboardEvent,
  isPlaying: boolean,
): CommandAction | null {
  // Space toggles pause/resume — handled before the static rules.
  if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return isPlaying ? CommandAction.PAUSE : CommandAction.RESUME;
  }
  for (const rule of STATIC_RULES) {
    if (rule.match(event)) return rule.action;
  }
  return null;
}

/** Returns true if the keyboard event originated from an editable element
 *  where typing should not trigger commands. */
export function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement) {
    // Check both the DOM property (real browsers) and the attribute
    // (some test environments don't propagate the attribute to the getter).
    if (target.isContentEditable) return true;
    const attr = target.getAttribute('contenteditable');
    if (attr !== null && attr !== 'false') return true;
  }
  return false;
}

export type KeyboardDispatch = (action: CommandAction) => void;

export class KeyboardCommandHandler {
  private listener: EventListener | null = null;
  private currentTarget: EventTarget | null = null;

  constructor(
    private readonly dispatch: KeyboardDispatch,
    private readonly options: KeyboardOptions,
  ) {}

  attach(target: EventTarget): void {
    if (this.listener) return;

    const handler: EventListener = (event) => {
      const e = event as KeyboardEvent;
      if (this.options.shouldSkip?.(e)) return;
      if (isEditableTarget(e)) return;

      const action = keyToAction(e, this.options.isPlaying());
      if (action === null) return;

      e.preventDefault();
      this.dispatch(action);
    };

    target.addEventListener('keydown', handler);
    this.listener = handler;
    this.currentTarget = target;
  }

  detach(): void {
    if (!this.listener || !this.currentTarget) return;
    this.currentTarget.removeEventListener('keydown', this.listener);
    this.listener = null;
    this.currentTarget = null;
  }
}
