import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandListener, isSpeechRecognitionSupported } from './recognition.js';

class FakeRecognition extends EventTarget {
  static instances: FakeRecognition[] = [];

  static throwOnConstruct: Error | null = null;
  static throwOnStart: Error | null = null;

  continuous = false;
  interimResults = false;
  lang = '';
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  constructor() {
    super();
    if (FakeRecognition.throwOnConstruct) {
      const err = FakeRecognition.throwOnConstruct;
      FakeRecognition.throwOnConstruct = null;
      throw err;
    }
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.startCalls += 1;
    if (FakeRecognition.throwOnStart) {
      const err = FakeRecognition.throwOnStart;
      FakeRecognition.throwOnStart = null;
      throw err;
    }
  }

  stop(): void {
    this.stopCalls += 1;
  }

  abort(): void {
    this.abortCalls += 1;
  }

  emitResult(transcript: string, isFinal = true): void {
    const event = new Event('result') as Event & {
      resultIndex?: number;
      results?: ArrayLike<{
        isFinal: boolean;
        length: number;
        [index: number]: { transcript: string };
      }>;
    };
    event.resultIndex = 0;
    event.results = [
      Object.assign({ isFinal, length: 1 }, { 0: { transcript } }) as never,
    ] as never;
    this.dispatchEvent(event);
  }

  emitEnd(): void {
    this.dispatchEvent(new Event('end'));
  }

  emitError(code: string, message?: string): void {
    const event = new Event('error') as Event & { error?: string; message?: string };
    event.error = code;
    if (message !== undefined) event.message = message;
    this.dispatchEvent(event);
  }
}

function lastInstance(): FakeRecognition {
  const last = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  if (!last) throw new Error('no FakeRecognition yet');
  return last;
}

describe('CommandListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.instances = [];
    FakeRecognition.throwOnConstruct = null;
    FakeRecognition.throwOnStart = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() begins listening and reports the configured locale', () => {
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
      lang: 'en-GB',
    });

    listener.start();

    expect(FakeRecognition.instances).toHaveLength(1);
    expect(lastInstance().startCalls).toBe(1);
    expect(lastInstance().lang).toBe('en-GB');
    expect(listener.isListening()).toBe(true);
  });

  it('emits final transcripts via onResult', () => {
    const onResult = vi.fn();
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
      onResult,
    });

    listener.start();
    lastInstance().emitResult('next memo', true);

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ transcript: 'next memo', isFinal: true });
  });

  it('ignores empty transcripts', () => {
    const onResult = vi.fn();
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
      onResult,
    });

    listener.start();
    lastInstance().emitResult('   ');
    lastInstance().emitResult('');

    expect(onResult).not.toHaveBeenCalled();
  });

  it('restarts on end with a base delay (always-on)', async () => {
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
    });

    listener.start();
    expect(FakeRecognition.instances).toHaveLength(1);

    lastInstance().emitEnd();
    expect(FakeRecognition.instances).toHaveLength(1); // not yet restarted

    await vi.advanceTimersByTimeAsync(300);
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it('does not restart after stop()', async () => {
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
    });

    listener.start();
    listener.stop();
    lastInstance().emitEnd();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(lastInstance().abortCalls).toBe(1);
    expect(listener.isListening()).toBe(false);
  });

  it('treats not-allowed as fatal: stops and fires onUnavailable', () => {
    const onError = vi.fn();
    const onUnavailable = vi.fn();
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
      onError,
      onUnavailable,
    });

    listener.start();
    lastInstance().emitError('not-allowed', 'mic blocked');

    expect(onError).toHaveBeenCalledWith({
      code: 'not-allowed',
      message: 'mic blocked',
      fatal: true,
    });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(listener.isListening()).toBe(false);
  });

  it('backs off exponentially on consecutive non-fatal errors', async () => {
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
    });

    listener.start();

    // First error → end → restart at 250ms*2^1 = 500ms
    lastInstance().emitError('no-speech');
    lastInstance().emitEnd();

    await vi.advanceTimersByTimeAsync(400);
    expect(FakeRecognition.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeRecognition.instances).toHaveLength(2);

    // Second error → end → restart at 250ms*2^2 = 1000ms
    lastInstance().emitError('no-speech');
    lastInstance().emitEnd();

    await vi.advanceTimersByTimeAsync(900);
    expect(FakeRecognition.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeRecognition.instances).toHaveLength(3);
  });

  it('caps the backoff at the configured ceiling', async () => {
    const listener = new CommandListener({
      recognitionConstructor: FakeRecognition as unknown as new () => InstanceType<
        typeof FakeRecognition
      >,
    });

    listener.start();

    // 100 consecutive non-fatal errors → restart delay should still be capped.
    for (let i = 0; i < 100; i++) {
      lastInstance().emitError('no-speech');
      lastInstance().emitEnd();
      await vi.advanceTimersByTimeAsync(8_500);
    }

    // We expect roughly 100 instances (one per cycle), not stuck at 1.
    expect(FakeRecognition.instances.length).toBeGreaterThan(50);
  });

  it('fires onUnavailable when no SpeechRecognition is on the global', () => {
    const onUnavailable = vi.fn();
    const listener = new CommandListener({
      onUnavailable,
      // recognitionConstructor not set; no SpeechRecognition global in test env.
    });

    listener.start();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(listener.isListening()).toBe(false);
  });

  it('isSpeechRecognitionSupported returns true when the constructor is on the global', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    expect(isSpeechRecognitionSupported()).toBe(true);
    vi.unstubAllGlobals();

    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    expect(isSpeechRecognitionSupported()).toBe(true);
    vi.unstubAllGlobals();

    expect(isSpeechRecognitionSupported()).toBe(false);
  });
});
