import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioRecorder, MAX_RECORDING_MS } from './recorder.js';

interface FakeTrack {
  stopped: boolean;
  stop(): void;
}

interface FakeStream {
  tracks: FakeTrack[];
  getTracks(): FakeTrack[];
}

function makeFakeStream(): FakeStream {
  const track: FakeTrack = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  return {
    tracks: [track],
    getTracks() {
      return this.tracks;
    },
  };
}

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static lastStream: FakeStream | null = null;

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';

  constructor(stream: FakeStream) {
    super();
    FakeMediaRecorder.lastStream = stream;
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    // Mirror real MediaRecorder ordering: dataavailable, then stop.
    queueMicrotask(() => {
      const dataEvent = new Event('dataavailable') as Event & { data?: Blob };
      dataEvent.data = new Blob(['fake-audio-bytes'], { type: this.mimeType });
      this.dispatchEvent(dataEvent);
      this.dispatchEvent(new Event('stop'));
    });
  }

  emitError(message: string): void {
    const errorEvent = new ErrorEvent('error', { message });
    this.dispatchEvent(errorEvent);
  }
}

describe('AudioRecorder', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.lastStream = null;

    getUserMedia = vi.fn().mockImplementation(() => Promise.resolve(makeFakeStream()));

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('requests microphone access with audio: true on start', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.isRecording()).toBe(true);
  });

  it('stop() resolves with a Blob containing the recorded chunks', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    const stopPromise = recorder.stop();
    await vi.runAllTimersAsync();
    const blob = await stopPromise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/webm');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('releases all media tracks after stop', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    const stream = FakeMediaRecorder.lastStream;
    expect(stream).not.toBeNull();

    const stopPromise = recorder.stop();
    await vi.runAllTimersAsync();
    await stopPromise;

    expect(stream?.tracks.every((t) => t.stopped)).toBe(true);
    expect(recorder.isRecording()).toBe(false);
  });

  it('throws if start is called while already recording', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    await expect(recorder.start()).rejects.toThrow(/already recording/);
  });

  it('throws if stop is called when not recording', async () => {
    const recorder = new AudioRecorder();
    await expect(recorder.stop()).rejects.toThrow(/not recording/);
  });

  it('auto-stops at the 2-minute hard cap and invokes onMaxDurationReached', async () => {
    const onMaxDurationReached = vi.fn();
    const recorder = new AudioRecorder({ onMaxDurationReached });

    await recorder.start();
    expect(recorder.isRecording()).toBe(true);

    // Advance just past the hard cap.
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS + 1);

    expect(onMaxDurationReached).toHaveBeenCalledTimes(1);
    expect(recorder.isRecording()).toBe(false);
  });

  it('fires onMaxDurationApproaching ~10s before the hard cap', async () => {
    const onMaxDurationApproaching = vi.fn();
    const recorder = new AudioRecorder({ onMaxDurationApproaching });

    await recorder.start();

    // Just before the warning window.
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS - 11_000);
    expect(onMaxDurationApproaching).not.toHaveBeenCalled();

    // Past the warning, before the hard cap.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onMaxDurationApproaching).toHaveBeenCalledTimes(1);
  });

  it('respects a custom maxDurationMs', async () => {
    const onMaxDurationReached = vi.fn();
    const recorder = new AudioRecorder({ maxDurationMs: 5_000, onMaxDurationReached });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(5_001);

    expect(onMaxDurationReached).toHaveBeenCalledTimes(1);
    expect(recorder.isRecording()).toBe(false);
  });

  it('clears the auto-stop timer when stop is called manually', async () => {
    const onMaxDurationReached = vi.fn();
    const recorder = new AudioRecorder({ onMaxDurationReached });

    await recorder.start();

    const stopPromise = recorder.stop();
    await vi.runAllTimersAsync();
    await stopPromise;

    // Even far in the future, the auto-stop callback must not fire.
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS + 60_000);
    expect(onMaxDurationReached).not.toHaveBeenCalled();
  });

  it('rejects stop() if the underlying MediaRecorder errors', async () => {
    const recorder = new AudioRecorder();
    await recorder.start();

    const recorderInstance = FakeMediaRecorder.instances[0];
    expect(recorderInstance).toBeDefined();

    const stopPromise = recorder.stop();
    recorderInstance!.emitError('mic disconnected');

    await expect(stopPromise).rejects.toThrow(/mic disconnected/);
    expect(recorder.isRecording()).toBe(false);
  });
});
