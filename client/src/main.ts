// Phase 1 final wiring: record + post + auto-play feed loop, with spoken
// feedback through the speak() pipeline.
//
// Phase 1 task 7 per INSTRUCTIONS.md § 9. The eyes-closed audit at the end
// of Phase 1 is "can a sighted dev with eyes closed and VoiceOver on
// record and hear back a memo?" — this file is what makes that yes.
//
// Hard rules honored at this entry point (§ 2):
// - #2 "One screen, one big button": index.html still has one <button> and
//   one live region. Nothing else.
// - #3 "Every state change is audible": every branch below calls speak().
// - #4 "App is never silent after a user action": fetch/upload errors
//   speak too. The catch arms are not optional.
// - #10 "No spoken phrase inlined": every speak() arg is a strings.ts key.

import { AudioRecorder } from './audio/recorder.js';
import { PlaybackQueue, type PlayableMemo } from './audio/playback-queue.js';
import { speak } from './voice/speak.js';

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

  const response = await fetch('/api/memos', {
    method: 'POST',
    body: form,
  });
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

  const queue = new PlaybackQueue({
    onAllEnded: () => speak('PLAYBACK_ALL_DONE', { liveRegion }),
    onError: () => speak('PLAYBACK_ERROR', { liveRegion }),
  });

  const recorder = new AudioRecorder({
    onMaxDurationApproaching: () =>
      speak('RECORDING_APPROACHING_LIMIT', { liveRegion }),
  });

  let busy = false;

  async function startRecording(): Promise<void> {
    try {
      await recorder.start();
      button.setAttribute('aria-label', RECORD_BUTTON_LABEL.recording);
      button.textContent = 'Stop & post';
      speak('RECORDING_STARTED', { liveRegion });
    } catch (err) {
      const isPermissionError =
        err instanceof Error &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      speak(
        isPermissionError ? 'RECORDING_PERMISSION_DENIED' : 'RECORDING_FAILED',
        { liveRegion },
      );
    }
  }

  async function stopAndPost(): Promise<void> {
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
      button.setAttribute('aria-label', RECORD_BUTTON_LABEL.idle);
      button.textContent = 'Record';
    }
  }

  button.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const action = recorder.isRecording() ? stopAndPost() : startRecording();
    void action.finally(() => {
      busy = false;
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
