// Dispatcher — turns a CommandAction into a side effect.
//
// Phase 2 task 5 per INSTRUCTIONS.md § 9. The voice listener (parser),
// the keyboard handler, and Phase 1's button click all funnel into one
// dispatch() call. That's the whole point: voice + keyboard reach feature
// parity (Phase 2 audit).
//
// Hard rules honored at this layer:
// - § 2 #3 "Every state change is audible": every action's confirmation
//   StringKey lives in registry.COMMAND_CONFIRMATION; the dispatcher fires
//   speak() with that key on the way out.
// - § 2 #4 "Never silent": the unknown-command path (parser returns null)
//   speaks STRINGS.UNKNOWN_COMMAND.
// - § 2 #10 "No spoken phrase inlined": every speak() call passes a
//   StringKey, never a literal.
// - § 2 #5 "Every voice command is cancellable": STOP routes to abort
//   recording, abort playback, or clear comment-pending state — whichever
//   applies.

import type { AudioRecorder } from '../audio/recorder.js';
import type { PlaybackQueue, PlayableMemo } from '../audio/playback-queue.js';
import { speak } from '../voice/speak.js';
import { CommandAction, COMMAND_CONFIRMATION } from './registry.js';

export interface DispatcherOptions {
  recorder: AudioRecorder;
  queue: PlaybackQueue;
  liveRegion: HTMLElement;
  /** Caller wires this to the actual upload + feed-fetch + queue.start
   *  flow. The dispatcher itself does not know about /api/memos. */
  onPostMemo: () => Promise<void>;
  /** Phase 4 will replace these no-ops with real backend calls. */
  onLike?: () => Promise<void>;
  onUnlike?: () => Promise<void>;
  onCommentStart?: () => void;
  /** Called on parser fallback (utterance not recognized). */
  onUnknownCommand?: () => void;
  /** Optional signal for "I'm in the middle of a comment" — STOP cancels
   *  this state too. */
  onCancelComment?: () => void;
}

/**
 * Dispatch one action. Speaks the matching confirmation key on success;
 * speaks UNKNOWN_COMMAND on `null`. Never throws.
 */
export async function dispatchCommand(
  action: CommandAction | null,
  opts: DispatcherOptions,
): Promise<void> {
  if (action === null) {
    opts.onUnknownCommand?.();
    speak('UNKNOWN_COMMAND', { liveRegion: opts.liveRegion });
    return;
  }

  try {
    switch (action) {
      case CommandAction.RECORD_START:
        if (opts.recorder.isRecording()) return;
        await opts.recorder.start();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.RECORD_STOP_POST:
        if (!opts.recorder.isRecording()) return;
        await opts.onPostMemo();
        // onPostMemo speaks RECORDING_POSTED itself (it knows whether the
        // upload succeeded). The dispatcher does not double-speak.
        return;

      case CommandAction.NEXT_MEMO:
        opts.queue.next();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.PREVIOUS_MEMO:
        opts.queue.previous();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.PAUSE:
        opts.queue.pause();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.RESUME:
        opts.queue.resume();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.LIKE:
        if (opts.onLike) await opts.onLike();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.UNLIKE:
        if (opts.onUnlike) await opts.onUnlike();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.COMMENT:
        opts.onCommentStart?.();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.STOP:
        // Universal kill switch (§ 2 #5). Cancel whichever long-running
        // state is active.
        if (opts.recorder.isRecording()) {
          // recorder.stop() returns a Blob we are about to throw away —
          // STOP means "discard", not "post".
          await opts.recorder.stop().catch(() => undefined);
        }
        opts.queue.stop();
        opts.onCancelComment?.();
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      case CommandAction.HELP:
        speak(COMMAND_CONFIRMATION[action], { liveRegion: opts.liveRegion });
        return;

      default: {
        // Exhaustiveness check — TS errors here if a new CommandAction is
        // added without a case above.
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  } catch {
    // Any side-effect that throws (recorder, queue, onLike) should not take
    // down the app. Speak a generic failure and move on.
    speak('UNKNOWN_COMMAND', { liveRegion: opts.liveRegion });
  }
}

/**
 * Convenience: parse + dispatch in one call. Used by the voice listener path.
 * Returns the resolved action so callers can log or react.
 */
export async function dispatchUtterance(
  utterance: string,
  parseFn: (s: string) => CommandAction | null,
  opts: DispatcherOptions,
): Promise<CommandAction | null> {
  const action = parseFn(utterance);
  await dispatchCommand(action, opts);
  return action;
}

// Re-export so callers do not have to touch the queue's PlayableMemo type
// just to wire up the dispatcher.
export type { PlayableMemo };
