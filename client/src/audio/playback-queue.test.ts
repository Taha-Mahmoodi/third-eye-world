import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlaybackQueue, type PlayableMemo } from './playback-queue.js';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];

  paused = true;
  currentTime = 0;
  src: string;
  error: unknown = null;

  // Hook for tests that want play() to reject.
  static playRejection: Error | null = null;

  constructor(src: string) {
    super();
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    if (FakeAudio.playRejection) {
      const err = FakeAudio.playRejection;
      FakeAudio.playRejection = null;
      return Promise.reject(err);
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  emitEnded(): void {
    this.dispatchEvent(new Event('ended'));
  }

  emitError(): void {
    this.dispatchEvent(new Event('error'));
  }
}

const m = (id: string): PlayableMemo => ({
  id,
  audio_url: `/api/memos/${id}/audio`,
  mime_type: 'audio/webm',
});

function lastInstance(): FakeAudio {
  const last = FakeAudio.instances[FakeAudio.instances.length - 1];
  if (!last) throw new Error('no FakeAudio instance yet');
  return last;
}

describe('PlaybackQueue', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudio.playRejection = null;
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires onMemoStart for the first memo on start()', () => {
    const onMemoStart = vi.fn();
    const queue = new PlaybackQueue({ onMemoStart });

    queue.load([m('a'), m('b'), m('c')]);
    queue.start();

    expect(onMemoStart).toHaveBeenCalledTimes(1);
    expect(onMemoStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 0);
    expect(queue.getState()).toEqual({ state: 'playing', cursor: 0, total: 3 });
  });

  it('auto-advances to the next memo when one ends', () => {
    const onMemoStart = vi.fn();
    const onMemoEnd = vi.fn();
    const queue = new PlaybackQueue({ onMemoStart, onMemoEnd });

    queue.load([m('a'), m('b'), m('c')]);
    queue.start();

    lastInstance().emitEnded();

    expect(onMemoEnd).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 0);
    expect(onMemoStart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), 1);
    expect(queue.getState().cursor).toBe(1);
  });

  it('fires onAllEnded after the last memo finishes naturally', () => {
    const onAllEnded = vi.fn();
    const queue = new PlaybackQueue({ onAllEnded });

    queue.load([m('a'), m('b')]);
    queue.start();
    lastInstance().emitEnded(); // a -> b
    lastInstance().emitEnded(); // b -> end

    expect(onAllEnded).toHaveBeenCalledTimes(1);
    expect(queue.getState().state).toBe('ended');
  });

  it('fires onAllEnded immediately if the queue is empty', () => {
    const onAllEnded = vi.fn();
    const queue = new PlaybackQueue({ onAllEnded });

    queue.load([]);
    queue.start();

    expect(onAllEnded).toHaveBeenCalledTimes(1);
    expect(queue.getState().state).toBe('ended');
  });

  it('next() skips to the next memo without firing onMemoEnd for the skipped one', () => {
    const onMemoEnd = vi.fn();
    const queue = new PlaybackQueue({ onMemoEnd });

    queue.load([m('a'), m('b')]);
    queue.start();
    queue.next();

    expect(onMemoEnd).not.toHaveBeenCalled();
    expect(queue.getState().cursor).toBe(1);
  });

  it('next() at the end fires onAllEnded', () => {
    const onAllEnded = vi.fn();
    const queue = new PlaybackQueue({ onAllEnded });

    queue.load([m('a')]);
    queue.start();
    queue.next();

    expect(onAllEnded).toHaveBeenCalledTimes(1);
    expect(queue.getState().state).toBe('ended');
  });

  it('previous() moves the cursor back, floored at 0', () => {
    const queue = new PlaybackQueue();

    queue.load([m('a'), m('b'), m('c')]);
    queue.start();
    queue.next();
    queue.next();
    expect(queue.getState().cursor).toBe(2);

    queue.previous();
    expect(queue.getState().cursor).toBe(1);
    queue.previous();
    expect(queue.getState().cursor).toBe(0);
    queue.previous();
    expect(queue.getState().cursor).toBe(0);
  });

  it('pause + resume keep the cursor in place and the queue in playing state after resume', () => {
    const queue = new PlaybackQueue();

    queue.load([m('a')]);
    queue.start();
    queue.pause();
    expect(queue.getState().state).toBe('paused');
    expect(lastInstance().paused).toBe(true);

    queue.resume();
    expect(queue.getState().state).toBe('playing');
    expect(lastInstance().paused).toBe(false);
  });

  it('stop() halts the current audio and goes idle without advancing', () => {
    const queue = new PlaybackQueue();

    queue.load([m('a'), m('b')]);
    queue.start();
    const audio = lastInstance();
    queue.stop();

    expect(audio.paused).toBe(true);
    expect(queue.getState()).toMatchObject({ state: 'idle', cursor: 0 });
  });

  it('on playback error, fires onError and advances', () => {
    const onError = vi.fn();
    const onMemoStart = vi.fn();
    const queue = new PlaybackQueue({ onError, onMemoStart });

    queue.load([m('a'), m('b')]);
    queue.start();
    lastInstance().emitError();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), expect.anything());
    expect(onMemoStart).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), 1);
    expect(queue.getState().cursor).toBe(1);
  });

  it('on play() rejection, fires onError and advances', async () => {
    const onError = vi.fn();
    const queue = new PlaybackQueue({ onError });

    queue.load([m('a'), m('b')]);
    FakeAudio.playRejection = new Error('autoplay denied');
    queue.start();

    // Wait for the rejection's microtask to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.any(Error),
    );
    expect(queue.getState().cursor).toBe(1);
  });

  it('load() while playing stops the previous audio', () => {
    const queue = new PlaybackQueue();

    queue.load([m('a')]);
    queue.start();
    const firstAudio = lastInstance();

    queue.load([m('x'), m('y')]);
    expect(firstAudio.paused).toBe(true);
    expect(queue.getState()).toMatchObject({ state: 'idle', cursor: 0, total: 2 });
  });
});
