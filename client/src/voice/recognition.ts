// CommandListener — always-on Web Speech API wrapper for short commands.
//
// Phase 2 task 3 per INSTRUCTIONS.md § 9.
//
// Web Speech API (`SpeechRecognition`) is the listener for short commands
// (§ 3). Memos go through MediaRecorder + Whisper. The browser API is
// session-based: each `start()` runs until the user stops talking, then
// fires `end`. This wrapper turns that into an always-on stream by
// restarting on `end` (with exponential backoff on persistent errors so we
// never spin).
//
// Hard rules from § 2 honored at this layer:
// - #5 "Every voice command is cancellable": the underlying SpeechRecognition
//   exposes abort(); stop() calls it and clears the want-running flag.
// - #4 "App is never silent": this module surfaces errors via onError so the
//   dispatcher can speak STRINGS.RECORDING_PERMISSION_DENIED or similar.

const RESTART_BASE_DELAY_MS = 250;
const RESTART_MAX_DELAY_MS = 8_000;
const ERROR_RESET_AFTER_MS = 5_000;

export interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
}

export interface CommandListenerOptions {
  /** Fires for every recognition result. Final results trigger commands;
   *  interim results are usually ignored by the dispatcher. */
  onResult?: (result: RecognitionResult) => void;
  /** Fires on a recognition error (e.g. mic permission denied, network
   *  failure). The listener restarts unless the error is fatal. */
  onError?: (error: { code: string; message: string; fatal: boolean }) => void;
  /** Fires when the listener gives up (fatal error, or
   *  SpeechRecognition not available). */
  onUnavailable?: () => void;
  /** BCP-47 locale. Defaults to 'en-US'. */
  lang?: string;
  /** Test seam — inject a constructor instead of using the browser global. */
  recognitionConstructor?: SpeechRecognitionConstructor;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: { readonly transcript: string };
  }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

const FATAL_ERROR_CODES = new Set(['not-allowed', 'service-not-allowed']);

function findRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const win = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return findRecognitionConstructor() !== null;
}

export class CommandListener {
  private recognition: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private errorResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CommandListenerOptions = {}) {}

  /** Begin always-on listening. Idempotent. */
  start(): void {
    if (this.wantRunning) return;
    this.wantRunning = true;
    this.startInternal();
  }

  /** Stop listening. Idempotent. */
  stop(): void {
    this.wantRunning = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.errorResetTimer) {
      clearTimeout(this.errorResetTimer);
      this.errorResetTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Some browsers throw if abort() is called before start completes.
        // Safe to ignore — we're shutting down.
      }
      this.recognition = null;
    }
    this.consecutiveErrors = 0;
  }

  isListening(): boolean {
    return this.wantRunning;
  }

  private startInternal(): void {
    if (!this.wantRunning) return;

    const Ctor = this.options.recognitionConstructor ?? findRecognitionConstructor();
    if (!Ctor) {
      this.options.onUnavailable?.();
      this.wantRunning = false;
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Ctor();
    } catch (err) {
      this.options.onError?.({
        code: 'construct-failed',
        message: err instanceof Error ? err.message : 'failed to construct SpeechRecognition',
        fatal: true,
      });
      this.options.onUnavailable?.();
      this.wantRunning = false;
      return;
    }

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = this.options.lang ?? 'en-US';

    recognition.addEventListener('result', (event) => {
      const e = event as SpeechRecognitionEventLike;
      const results = e.results;
      if (results.length === 0) return;
      const last = results[results.length - 1];
      if (!last || last.length === 0) return;
      const alt = last[0];
      if (!alt) return;
      const transcript = alt.transcript.trim();
      if (transcript.length === 0) return;
      this.options.onResult?.({ transcript, isFinal: last.isFinal });
    });

    recognition.addEventListener('error', (event) => {
      const e = event as SpeechRecognitionErrorEventLike;
      const code = e.error || 'unknown';
      const fatal = FATAL_ERROR_CODES.has(code);
      this.options.onError?.({
        code,
        message: e.message ?? code,
        fatal,
      });
      if (fatal) {
        this.wantRunning = false;
        this.options.onUnavailable?.();
      } else {
        this.consecutiveErrors += 1;
        this.scheduleErrorReset();
      }
    });

    recognition.addEventListener('end', () => {
      this.recognition = null;
      if (!this.wantRunning) return;
      // Backoff grows with consecutive errors and resets on a clean session.
      const delay = Math.min(
        RESTART_BASE_DELAY_MS * 2 ** this.consecutiveErrors,
        RESTART_MAX_DELAY_MS,
      );
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.startInternal();
      }, delay);
    });

    try {
      recognition.start();
    } catch (err) {
      // Calling start() twice on the same instance throws InvalidStateError.
      // Clear and retry on the next tick.
      this.options.onError?.({
        code: 'start-failed',
        message: err instanceof Error ? err.message : 'failed to start',
        fatal: false,
      });
      return;
    }
    this.recognition = recognition;
  }

  private scheduleErrorReset(): void {
    if (this.errorResetTimer) {
      clearTimeout(this.errorResetTimer);
    }
    this.errorResetTimer = setTimeout(() => {
      this.consecutiveErrors = 0;
      this.errorResetTimer = null;
    }, ERROR_RESET_AFTER_MS);
  }
}
