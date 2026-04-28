// Playback queue — auto-plays memos in sequence.
//
// Phase 1 task 6 per INSTRUCTIONS.md § 9. The client fetches /api/memos,
// hands the result to a PlaybackQueue, and the queue plays each memo's
// audio_url end-to-end then advances. The "next / previous / pause /
// resume" actions are wired here as plain method calls; Phase 2 will hook
// them up to voice commands and keyboard shortcuts (`feature/voice-grammar`,
// `feature/keyboard-equivalents`).
//
// Hard rules from § 2 already respected at this layer:
// - "Every state change is audible": the callbacks (onMemoStart / onMemoEnd /
//   onAllEnded / onError) are the hooks that the spoken-feedback layer fires
//   on. This module does not speak anything itself — the strings live in
//   client/src/strings.ts (Phase 2 task 2 / Phase 1 task 7).
// - "The app is never silent after a user action": onError fires for every
//   playback failure so the caller can degrade gracefully (e.g. skip the
//   memo and announce "couldn't play that one").

export interface PlayableMemo {
  id: string;
  audio_url: string;
  /** Optional — if supplied, used as the `<audio>` element's `type` hint. */
  mime_type?: string;
}

export interface PlaybackQueueCallbacks {
  /** Fires when a memo starts playing. */
  onMemoStart?: (memo: PlayableMemo, index: number) => void;
  /** Fires when a memo finishes naturally (not when skipped). */
  onMemoEnd?: (memo: PlayableMemo, index: number) => void;
  /** Fires when the queue runs out of memos. */
  onAllEnded?: () => void;
  /** Fires on a playback error. The queue advances past the broken memo. */
  onError?: (memo: PlayableMemo, error: unknown) => void;
}

type QueueState = 'idle' | 'playing' | 'paused' | 'ended';

export class PlaybackQueue {
  private memos: PlayableMemo[] = [];
  private cursor = 0;
  private state: QueueState = 'idle';
  private currentAudio: HTMLAudioElement | null = null;

  constructor(private readonly callbacks: PlaybackQueueCallbacks = {}) {}

  /** Replace the queue. Stops anything currently playing. */
  load(memos: PlayableMemo[]): void {
    this.stopCurrent();
    this.memos = [...memos];
    this.cursor = 0;
    this.state = 'idle';
  }

  /** Begin playing from the current cursor. No-op if already playing. */
  start(): void {
    if (this.state === 'playing') return;
    if (this.memos.length === 0) {
      this.state = 'ended';
      this.callbacks.onAllEnded?.();
      return;
    }
    this.playAtCursor();
  }

  /** Pause the current memo. Idempotent. */
  pause(): void {
    if (this.state !== 'playing') return;
    this.currentAudio?.pause();
    this.state = 'paused';
  }

  /** Resume from the paused position. No-op if not paused. */
  resume(): void {
    if (this.state !== 'paused' || !this.currentAudio) return;
    void this.currentAudio.play().catch((err) => {
      const memo = this.memos[this.cursor];
      if (memo) this.callbacks.onError?.(memo, err);
      this.advance();
    });
    this.state = 'playing';
  }

  /** Skip to the next memo. */
  next(): void {
    this.stopCurrent();
    this.cursor += 1;
    if (this.cursor >= this.memos.length) {
      this.state = 'ended';
      this.callbacks.onAllEnded?.();
      return;
    }
    this.playAtCursor();
  }

  /** Go back to the previous memo. Floors at 0. */
  previous(): void {
    this.stopCurrent();
    this.cursor = Math.max(0, this.cursor - 1);
    this.playAtCursor();
  }

  /** Stop playback and clear the current audio. The cursor stays put. */
  stop(): void {
    this.stopCurrent();
    this.state = 'idle';
  }

  /** Read-only snapshot of the queue. */
  getState(): { state: QueueState; cursor: number; total: number } {
    return { state: this.state, cursor: this.cursor, total: this.memos.length };
  }

  /** The memo at the current cursor (i.e. the one playing or paused).
   *  Returns null when the queue is idle, ended, or empty. Used by the
   *  dispatcher hooks for "like the current memo", "comment on it", etc. */
  getCurrentMemo(): PlayableMemo | null {
    if (this.state === 'ended' || this.state === 'idle') return null;
    return this.memos[this.cursor] ?? null;
  }

  private playAtCursor(): void {
    const memo = this.memos[this.cursor];
    if (!memo) {
      this.state = 'ended';
      this.callbacks.onAllEnded?.();
      return;
    }

    const audio = new Audio(memo.audio_url);
    audio.addEventListener(
      'ended',
      () => {
        // Only advance if we're still the active audio — guards against
        // a stop()/next() that already cleared us.
        if (this.currentAudio !== audio) return;
        this.callbacks.onMemoEnd?.(memo, this.cursor);
        this.advance();
      },
      { once: true },
    );
    audio.addEventListener(
      'error',
      () => {
        if (this.currentAudio !== audio) return;
        this.callbacks.onError?.(memo, audio.error ?? new Error('audio error'));
        this.advance();
      },
      { once: true },
    );

    this.currentAudio = audio;
    this.state = 'playing';
    this.callbacks.onMemoStart?.(memo, this.cursor);

    void audio.play().catch((err) => {
      if (this.currentAudio !== audio) return;
      this.callbacks.onError?.(memo, err);
      this.advance();
    });
  }

  private advance(): void {
    this.currentAudio = null;
    this.cursor += 1;
    if (this.cursor >= this.memos.length) {
      this.state = 'ended';
      this.callbacks.onAllEnded?.();
      return;
    }
    this.playAtCursor();
  }

  private stopCurrent(): void {
    if (!this.currentAudio) return;
    this.currentAudio.pause();
    this.currentAudio.currentTime = 0;
    this.currentAudio = null;
  }
}
