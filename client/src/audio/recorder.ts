// Audio recorder — thin wrapper around MediaRecorder.
//
// Phase 1 task 1 per INSTRUCTIONS.md § 9. Owns the start/stop lifecycle and
// the 2-minute hard cap from § 13 ("All audio uploads capped at 5MB / 2
// minutes"). The cap is enforced here as a safety net — the spoken warning
// before auto-stop lands in feature/spoken-feedback-fallback (Phase 1 task 7),
// where the recorder's onMaxDurationApproaching callback wires up to the
// strings.ts speak pipeline.

export const MAX_RECORDING_MS = 120_000;
export const APPROACHING_MAX_MS = 110_000; // 10s warning window

export interface AudioRecorderOptions {
  /** Hard stop in milliseconds. Defaults to MAX_RECORDING_MS. */
  maxDurationMs?: number;
  /** Fires once when only ~10 seconds remain. Use this to play the spoken warning. */
  onMaxDurationApproaching?: () => void;
  /** Fires when the recorder auto-stops at maxDurationMs. */
  onMaxDurationReached?: () => void;
}

type RecorderState = 'idle' | 'recording' | 'stopping' | 'stopped';

export class AudioRecorder {
  private state: RecorderState = 'idle';
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  private hardStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: AudioRecorderOptions = {}) {}

  isRecording(): boolean {
    return this.state === 'recording';
  }

  async start(): Promise<void> {
    if (this.state === 'recording' || this.state === 'stopping') {
      throw new Error('AudioRecorder.start: already recording');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.chunks = [];

    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });

    this.mediaRecorder.start();
    this.state = 'recording';

    const max = this.options.maxDurationMs ?? MAX_RECORDING_MS;
    const warnAt = Math.max(0, max - (MAX_RECORDING_MS - APPROACHING_MAX_MS));

    if (this.options.onMaxDurationApproaching && warnAt > 0 && warnAt < max) {
      this.warnTimer = setTimeout(() => {
        this.options.onMaxDurationApproaching?.();
      }, warnAt);
    }

    this.hardStopTimer = setTimeout(() => {
      this.options.onMaxDurationReached?.();
      // Best-effort auto-stop. Errors here are not actionable for the caller.
      this.stop().catch(() => undefined);
    }, max);
  }

  async stop(): Promise<Blob> {
    if (this.state !== 'recording') {
      throw new Error('AudioRecorder.stop: not recording');
    }
    this.state = 'stopping';
    this.clearTimers();

    return new Promise<Blob>((resolve, reject) => {
      const recorder = this.mediaRecorder;
      if (!recorder) {
        this.cleanup();
        reject(new Error('AudioRecorder.stop: no active MediaRecorder'));
        return;
      }

      const onStop = (): void => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.cleanup();
        resolve(blob);
      };

      const onError = (event: Event): void => {
        this.cleanup();
        const message =
          event instanceof ErrorEvent && event.message
            ? event.message
            : 'MediaRecorder error';
        reject(new Error(message));
      };

      recorder.addEventListener('stop', onStop, { once: true });
      recorder.addEventListener('error', onError, { once: true });
      recorder.stop();
    });
  }

  private clearTimers(): void {
    if (this.warnTimer) {
      clearTimeout(this.warnTimer);
      this.warnTimer = null;
    }
    if (this.hardStopTimer) {
      clearTimeout(this.hardStopTimer);
      this.hardStopTimer = null;
    }
  }

  private cleanup(): void {
    this.clearTimers();
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.state = 'stopped';
  }
}
