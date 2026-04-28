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
import { CommandListener } from './voice/recognition.js';
import { CommandAction } from './commands/registry.js';
import { parseCommand } from './commands/parser.js';
import { dispatchCommand } from './commands/dispatcher.js';
import { KeyboardCommandHandler } from './commands/keyboard.js';

const RECORD_BUTTON_LABEL = {
  idle: 'Start recording a memo',
  recording: 'Stop recording and post',
} as const;

interface MemosListResponse {
  memos: Array<{
    id: string;
    audio_url: string;
    mime_type: string;
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

  // The "post-memo flow" the dispatcher invokes on RECORD_STOP_POST. Owns
  // its own user-facing speak() calls because only it knows whether the
  // upload + fetch + queue.start sequence succeeded.
  async function runPostFlow(): Promise<void> {
    try {
      const blob = await recorder.stop();
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
    } catch {
      speak('RECORDING_FAILED', { liveRegion });
    } finally {
      setButtonState('idle');
    }
  }

  // The button-state side effects of RECORD_START aren't visible to the
  // dispatcher itself (it just calls recorder.start). We attach a tiny
  // proxy that flips the label after the recorder is actually started.
  const dispatcherOptions = {
    recorder,
    queue,
    liveRegion,
    onPostMemo: runPostFlow,
  };

  async function dispatch(action: CommandAction | null): Promise<void> {
    const wasRecording = recorder.isRecording();
    await dispatchCommand(action, dispatcherOptions);
    // Mirror state changes onto the button. The dispatcher is intentionally
    // unaware of UI; this is the seam where it lands.
    if (action === CommandAction.RECORD_START && !wasRecording && recorder.isRecording()) {
      setButtonState('recording');
    }
    if (action === CommandAction.STOP && wasRecording) {
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

  // Voice command listener — always-on. Errors degrade gracefully:
  // mic-permission-denied speaks RECORDING_PERMISSION_DENIED and the user
  // can still use the button + keyboard.
  const listener = new CommandListener({
    onResult: ({ transcript, isFinal }) => {
      if (!isFinal) return;
      void dispatch(parseCommand(transcript));
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
