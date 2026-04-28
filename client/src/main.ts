// Phase 2 final wiring: voice + keyboard reach feature parity.
//
// Phase 2 closes the loop where every voice command works via keyboard too
// (§ 2 #6, voice-grammar skill). Click on the record button still works;
// voice ("record" / "post") still works; keyboard (R / Enter) still works.
// All three paths funnel through dispatchCommand().
//
// Hard rules honored at this entry point (§ 2):
// - #2 "One screen, one big button": index.html still has one <button> + one
//   live region. Nothing else.
// - #3 "Every state change is audible": dispatchCommand() speaks on every
//   action; queue + recorder events still speak from Phase 1.
// - #4 "App is never silent after a user action": fetch / upload errors
//   speak; UNKNOWN_COMMAND speaks on parser fallback.
// - #5 "Every voice command is cancellable": STOP / Escape kills recorder +
//   queue + comment-pending state.
// - #6 "Keyboard-only operability": KeyboardCommandHandler covers all 11
//   actions.
// - #10 "No spoken phrase inlined": every speak() call passes a StringKey.

import { AudioRecorder } from './audio/recorder.js';
import { PlaybackQueue, type PlayableMemo } from './audio/playback-queue.js';
import { speak } from './voice/speak.js';
import { STRINGS } from './strings.js';
import { CommandListener } from './voice/recognition.js';
import { routeViaLlm } from './voice/llm-pipeline.js';
import { CommandAction } from './commands/registry.js';
import { parseCommand } from './commands/parser.js';
import { dispatchCommand } from './commands/dispatcher.js';
import { KeyboardCommandHandler } from './commands/keyboard.js';

/** Build the spoken replies-announcement using the strings.ts template.
 *  The phrase wording stays in strings.ts (§ 2 #10 escape hatch for
 *  variable-bearing phrases — see speak() textOverride). */
function repliesAnnouncementText(count: number): string {
  if (count === 1) return STRINGS.REPLIES_ANNOUNCEMENT_ONE;
  return STRINGS.REPLIES_ANNOUNCEMENT_MANY.replace('{count}', String(count));
}

const RECORD_BUTTON_LABEL = {
  idle: 'Start recording a memo',
  recording: 'Stop recording and post',
} as const;

interface MemosListResponse {
  memos: Array<{
    id: string;
    audio_url: string;
    mime_type: string;
    comment_count?: number;
  }>;
}

function isMemosListResponse(value: unknown): value is MemosListResponse {
  if (!value || typeof value !== 'object') return false;
  const memos = (value as { memos?: unknown }).memos;
  if (!Array.isArray(memos)) return false;
  return memos.every(
    (m) =>
      m &&
      typeof m === 'object' &&
      typeof (m as { id?: unknown }).id === 'string' &&
      typeof (m as { audio_url?: unknown }).audio_url === 'string',
  );
}

async function postMemo(blob: Blob): Promise<void> {
  const form = new FormData();
  form.append('audio', blob, 'memo');
  const response = await fetch('/api/memos', { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`POST /api/memos failed: ${response.status}`);
  }
}

async function fetchFeed(): Promise<PlayableMemo[]> {
  const response = await fetch('/api/memos');
  if (!response.ok) {
    throw new Error(`GET /api/memos failed: ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!isMemosListResponse(data)) {
    throw new Error('GET /api/memos returned an unexpected shape');
  }
  return data.memos.map((m) => ({
    id: m.id,
    audio_url: m.audio_url,
    mime_type: m.mime_type,
    comment_count: typeof m.comment_count === 'number' ? m.comment_count : 0,
  }));
}

function init(): void {
  const buttonEl = document.getElementById('record');
  const liveRegionEl = document.getElementById('status');
  if (!(buttonEl instanceof HTMLButtonElement)) return;
  if (!(liveRegionEl instanceof HTMLElement)) return;
  const button: HTMLButtonElement = buttonEl;
  const liveRegion: HTMLElement = liveRegionEl;

  let isPlaybackActive = false;

  const queue = new PlaybackQueue({
    onMemoStart: () => {
      isPlaybackActive = true;
    },
    onMemoEnd: (memo) => {
      // Phase 4 task 5: announce replies between memos. Static phrase for 1
      // reply, templated phrase otherwise. The next memo starts immediately
      // after — the announcement is short on purpose so it does not delay
      // playback.
      const count = memo.comment_count ?? 0;
      if (count > 0) {
        speak('REPLIES_ANNOUNCEMENT_MANY', {
          liveRegion,
          textOverride: repliesAnnouncementText(count),
        });
      }
    },
    onAllEnded: () => {
      isPlaybackActive = false;
      speak('PLAYBACK_ALL_DONE', { liveRegion });
    },
    onError: () => speak('PLAYBACK_ERROR', { liveRegion }),
  });

  const recorder = new AudioRecorder({
    onMaxDurationApproaching: () =>
      speak('RECORDING_APPROACHING_LIMIT', { liveRegion }),
  });

  function setButtonState(state: 'idle' | 'recording'): void {
    button.setAttribute('aria-label', RECORD_BUTTON_LABEL[state]);
    button.textContent = state === 'recording' ? 'Stop & post' : 'Record';
  }

  // What the next "stop & post" should do — record a top-level memo, or
  // record a comment attached to a specific memo.
  type RecordingTarget = 'memo' | { type: 'comment'; memoId: string } | null;
  let recordingTarget: RecordingTarget = null;

  async function postMemoFlow(blob: Blob): Promise<void> {
    await postMemo(blob);
    speak('RECORDING_POSTED', { liveRegion });

    const memos = await fetchFeed();
    if (memos.length === 0) {
      speak('FEED_EMPTY', { liveRegion });
      return;
    }
    speak('PLAYBACK_STARTING', { liveRegion });
    queue.load(memos);
    queue.start();
  }

  async function postCommentFlow(memoId: string, blob: Blob): Promise<void> {
    const form = new FormData();
    form.append('audio', blob, 'comment');
    const response = await fetch(`/api/memos/${memoId}/comments`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(`POST /api/memos/${memoId}/comments failed: ${response.status}`);
    }
    speak('COMMENT_POSTED', { liveRegion });
    // Resume the parent feed so the listener can keep going.
    queue.resume();
  }

  // The dispatcher invokes this on RECORD_STOP_POST. We branch on
  // recordingTarget — set when the recorder started, cleared in `finally`.
  async function runPostFlow(): Promise<void> {
    const target = recordingTarget;
    try {
      const blob = await recorder.stop();
      if (target && target !== 'memo' && target.type === 'comment') {
        await postCommentFlow(target.memoId, blob);
      } else {
        await postMemoFlow(blob);
      }
    } catch {
      speak(
        target && target !== 'memo' && target.type === 'comment'
          ? 'COMMENT_FAILED'
          : 'RECORDING_FAILED',
        { liveRegion },
      );
    } finally {
      recordingTarget = null;
      setButtonState('idle');
    }
  }

  async function likeCurrent(method: 'POST' | 'DELETE'): Promise<void> {
    const memo = queue.getCurrentMemo();
    if (!memo) return;
    const response = await fetch(`/api/memos/${memo.id}/like`, { method });
    if (!response.ok) {
      throw new Error(`like ${method} failed: ${response.status}`);
    }
  }

  function startCommentRecording(): void {
    const memo = queue.getCurrentMemo();
    if (!memo) return; // dispatcher should have caught this
    queue.pause();
    recordingTarget = { type: 'comment', memoId: memo.id };
    void recorder.start().catch(() => {
      recordingTarget = null;
      speak('RECORDING_FAILED', { liveRegion });
    });
    setButtonState('recording');
  }

  // The button-state side effects of RECORD_START aren't visible to the
  // dispatcher itself (it just calls recorder.start). We attach a tiny
  // proxy that flips the label after the recorder is actually started.
  const dispatcherOptions = {
    recorder,
    queue,
    liveRegion,
    onPostMemo: runPostFlow,
    onLike: () => likeCurrent('POST'),
    onUnlike: () => likeCurrent('DELETE'),
    onCommentStart: startCommentRecording,
    getCurrentMemo: () => queue.getCurrentMemo(),
  };

  async function dispatch(action: CommandAction | null): Promise<void> {
    const wasRecording = recorder.isRecording();
    await dispatchCommand(action, dispatcherOptions);
    // Mirror state changes onto the button. The dispatcher is intentionally
    // unaware of UI; this is the seam where it lands.
    if (action === CommandAction.RECORD_START && !wasRecording && recorder.isRecording()) {
      // RECORD_START always means a top-level memo (the user said "record"
      // or pressed R). COMMENT goes through onCommentStart instead.
      recordingTarget = 'memo';
      setButtonState('recording');
    }
    if (action === CommandAction.STOP && wasRecording) {
      recordingTarget = null;
      setButtonState('idle');
    }
  }

  // Click on the button: depending on state, it's RECORD_START or RECORD_STOP_POST.
  button.addEventListener('click', () => {
    void dispatch(
      recorder.isRecording()
        ? CommandAction.RECORD_STOP_POST
        : CommandAction.RECORD_START,
    );
  });

  // Keyboard equivalents — covers all 11 actions per the voice-grammar skill.
  const keyboard = new KeyboardCommandHandler(
    (action) => void dispatch(action),
    { isPlaying: () => isPlaybackActive },
  );
  keyboard.attach(document);

  // Phase 5 task 6: full pipeline wiring.
  //
  // Each finalized voice transcript goes through:
  //   1. /api/llm → returns { speak_text, client_actions, executed }
  //      Server-side dispatcher already ran like_memo / unlike_memo;
  //      we just speak the phrase + dispatch the client_actions.
  //   2. If /api/llm is disabled / errored / timed out, fall back to
  //      the Phase 2 deterministic parser (Phase 5 task 7).
  //
  // The LLM is OFF by default (LLM_BASE_URL unset → server returns 503),
  // so today this is a single round-trip + fallback. Once Ollama / vLLM
  // is configured, the LLM path takes over.
  async function handleTranscript(transcript: string): Promise<void> {
    const current = queue.getCurrentMemo();
    const context = current
      ? { current_memo: { id: current.id, user_name: 'Demo' } }
      : {};
    const outcome = await routeViaLlm(transcript, context);
    if (outcome.status === 'ok') {
      speak('UNKNOWN_COMMAND', {
        liveRegion,
        textOverride: outcome.result.speak_text,
      });
      for (const action of outcome.result.actions) {
        await dispatch(action);
      }
      return;
    }
    // LLM disabled or errored → try the deterministic Phase 2 parser.
    const parsed = parseCommand(transcript);
    if (parsed !== null) {
      await dispatch(parsed);
      return;
    }
    // Both failed. If the LLM was tried (errored, not just disabled),
    // speak the contextual degraded message (§ 18). Otherwise the
    // generic UNKNOWN_COMMAND.
    if (outcome.status === 'errored') {
      speak('DEGRADED_MODE', { liveRegion });
    } else {
      speak('UNKNOWN_COMMAND', { liveRegion });
    }
  }

  // Voice command listener — always-on. Errors degrade gracefully:
  // mic-permission-denied speaks RECORDING_PERMISSION_DENIED and the user
  // can still use the button + keyboard.
  const listener = new CommandListener({
    onResult: ({ transcript, isFinal }) => {
      if (!isFinal) return;
      void handleTranscript(transcript);
    },
    onError: ({ fatal }) => {
      if (fatal) speak('RECORDING_PERMISSION_DENIED', { liveRegion });
    },
  });
  listener.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
