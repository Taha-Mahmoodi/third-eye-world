import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dispatchCommand, dispatchUtterance } from './dispatcher.js';
import { CommandAction } from './registry.js';
import { STRINGS } from '../strings.js';

interface FakeSynthesis {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

class FakeUtterance {
  static lastText: string | null = null;
  constructor(text: string) {
    FakeUtterance.lastText = text;
  }
  rate = 1;
  pitch = 1;
}

function makeFakeRecorder(): {
  isRecording: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    isRecording: vi.fn().mockReturnValue(false),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(new Blob()),
  };
}

function makeFakeQueue(): {
  next: ReturnType<typeof vi.fn>;
  previous: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    next: vi.fn(),
    previous: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
}

describe('dispatchCommand', () => {
  let synth: FakeSynthesis;
  let liveRegion: HTMLDivElement;
  let recorder: ReturnType<typeof makeFakeRecorder>;
  let queue: ReturnType<typeof makeFakeQueue>;
  let onPostMemo: ReturnType<typeof vi.fn>;
  let onLike: ReturnType<typeof vi.fn>;
  let onUnlike: ReturnType<typeof vi.fn>;
  let onCommentStart: ReturnType<typeof vi.fn>;
  let onUnknownCommand: ReturnType<typeof vi.fn>;

  function opts() {
    return {
      recorder: recorder as never,
      queue: queue as never,
      liveRegion,
      onPostMemo,
      onLike,
      onUnlike,
      onCommentStart,
      onUnknownCommand,
    };
  }

  beforeEach(() => {
    synth = { speak: vi.fn(), cancel: vi.fn() };
    FakeUtterance.lastText = null;
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    liveRegion = document.createElement('div');
    document.body.appendChild(liveRegion);

    recorder = makeFakeRecorder();
    queue = makeFakeQueue();
    onPostMemo = vi.fn().mockResolvedValue(undefined);
    onLike = vi.fn().mockResolvedValue(undefined);
    onUnlike = vi.fn().mockResolvedValue(undefined);
    onCommentStart = vi.fn();
    onUnknownCommand = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    liveRegion.remove();
  });

  it('null action speaks UNKNOWN_COMMAND and notifies onUnknownCommand', async () => {
    await dispatchCommand(null, opts());
    expect(onUnknownCommand).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.UNKNOWN_COMMAND);
  });

  it('RECORD_START calls recorder.start and speaks RECORDING_STARTED', async () => {
    await dispatchCommand(CommandAction.RECORD_START, opts());
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.RECORDING_STARTED);
  });

  it('RECORD_START is a no-op when already recording', async () => {
    recorder.isRecording.mockReturnValue(true);
    await dispatchCommand(CommandAction.RECORD_START, opts());
    expect(recorder.start).not.toHaveBeenCalled();
    // No speak() either — silent no-op is OK because the user is mid-record;
    // they'll get their RECORDING_POSTED feedback when they actually post.
  });

  it('RECORD_STOP_POST calls onPostMemo when recording', async () => {
    recorder.isRecording.mockReturnValue(true);
    await dispatchCommand(CommandAction.RECORD_STOP_POST, opts());
    expect(onPostMemo).toHaveBeenCalledTimes(1);
  });

  it('RECORD_STOP_POST is a no-op when not recording', async () => {
    recorder.isRecording.mockReturnValue(false);
    await dispatchCommand(CommandAction.RECORD_STOP_POST, opts());
    expect(onPostMemo).not.toHaveBeenCalled();
  });

  it('NEXT_MEMO calls queue.next and speaks PLAYBACK_NEXT', async () => {
    await dispatchCommand(CommandAction.NEXT_MEMO, opts());
    expect(queue.next).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.PLAYBACK_NEXT);
  });

  it('PREVIOUS_MEMO calls queue.previous and speaks PLAYBACK_PREVIOUS', async () => {
    await dispatchCommand(CommandAction.PREVIOUS_MEMO, opts());
    expect(queue.previous).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.PLAYBACK_PREVIOUS);
  });

  it('PAUSE calls queue.pause and speaks PLAYBACK_PAUSED', async () => {
    await dispatchCommand(CommandAction.PAUSE, opts());
    expect(queue.pause).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.PLAYBACK_PAUSED);
  });

  it('RESUME calls queue.resume and speaks PLAYBACK_RESUMED', async () => {
    await dispatchCommand(CommandAction.RESUME, opts());
    expect(queue.resume).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.PLAYBACK_RESUMED);
  });

  it('LIKE speaks LIKED immediately and fires onLike (fire-and-forget)', async () => {
    await dispatchCommand(CommandAction.LIKE, opts());
    // Spoken confirmation lands synchronously; onLike() is invoked but
    // the dispatcher does not await its promise.
    expect(liveRegion.textContent).toBe(STRINGS.LIKED);
    expect(onLike).toHaveBeenCalledTimes(1);
  });

  it('LIKE swallows a network error from onLike (user already heard "Liked.")', async () => {
    onLike.mockRejectedValueOnce(new Error('500 from /api/memos/x/like'));
    await expect(
      dispatchCommand(CommandAction.LIKE, opts()),
    ).resolves.toBeUndefined();
    expect(liveRegion.textContent).toBe(STRINGS.LIKED);
    // Flush the pending rejection so vitest does not flag an unhandled
    // rejection at teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('UNLIKE speaks UNLIKED immediately and fires onUnlike (fire-and-forget)', async () => {
    await dispatchCommand(CommandAction.UNLIKE, opts());
    expect(liveRegion.textContent).toBe(STRINGS.UNLIKED);
    expect(onUnlike).toHaveBeenCalledTimes(1);
  });

  it('UNLIKE swallows a network error from onUnlike', async () => {
    onUnlike.mockRejectedValueOnce(new Error('boom'));
    await expect(
      dispatchCommand(CommandAction.UNLIKE, opts()),
    ).resolves.toBeUndefined();
    expect(liveRegion.textContent).toBe(STRINGS.UNLIKED);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('COMMENT triggers onCommentStart and speaks COMMENT_RECORDING when there is a current memo', async () => {
    const getCurrentMemo = vi.fn().mockReturnValue({ id: 'm-1' });
    await dispatchCommand(CommandAction.COMMENT, { ...opts(), getCurrentMemo });
    expect(onCommentStart).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.COMMENT_RECORDING);
  });

  it('COMMENT speaks NO_MEMO_TO_REPLY_TO when getCurrentMemo returns null', async () => {
    const getCurrentMemo = vi.fn().mockReturnValue(null);
    await dispatchCommand(CommandAction.COMMENT, { ...opts(), getCurrentMemo });
    expect(onCommentStart).not.toHaveBeenCalled();
    expect(liveRegion.textContent).toBe(STRINGS.NO_MEMO_TO_REPLY_TO);
  });

  it('COMMENT falls back to legacy behavior when getCurrentMemo is not provided', async () => {
    // Pre-Phase-4 callers: dispatcher does NOT short-circuit and just
    // speaks COMMENT_RECORDING + fires onCommentStart.
    await dispatchCommand(CommandAction.COMMENT, opts());
    expect(onCommentStart).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.COMMENT_RECORDING);
  });

  it('STOP cancels recording + queue + comment-pending and speaks CANCELLED', async () => {
    const onCancelComment = vi.fn();
    recorder.isRecording.mockReturnValue(true);
    await dispatchCommand(CommandAction.STOP, { ...opts(), onCancelComment });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(queue.stop).toHaveBeenCalledTimes(1);
    expect(onCancelComment).toHaveBeenCalledTimes(1);
    expect(liveRegion.textContent).toBe(STRINGS.CANCELLED);
  });

  it('STOP is safe to dispatch when nothing is running', async () => {
    recorder.isRecording.mockReturnValue(false);
    await dispatchCommand(CommandAction.STOP, opts());
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(queue.stop).toHaveBeenCalledTimes(1); // queue.stop is always safe
    expect(liveRegion.textContent).toBe(STRINGS.CANCELLED);
  });

  it('HELP speaks HELP_LIST', async () => {
    await dispatchCommand(CommandAction.HELP, opts());
    expect(liveRegion.textContent).toBe(STRINGS.HELP_LIST);
  });

  it('a thrown side effect speaks UNKNOWN_COMMAND and never throws', async () => {
    recorder.start.mockRejectedValueOnce(new Error('boom'));
    await expect(
      dispatchCommand(CommandAction.RECORD_START, opts()),
    ).resolves.toBeUndefined();
    expect(liveRegion.textContent).toBe(STRINGS.UNKNOWN_COMMAND);
  });
});

describe('dispatchUtterance', () => {
  it('parses the utterance and dispatches the resolved action', async () => {
    const liveRegion = document.createElement('div');
    document.body.appendChild(liveRegion);
    const recorder = makeFakeRecorder();
    const queue = makeFakeQueue();

    const parseFn = vi.fn().mockReturnValue(CommandAction.NEXT_MEMO);

    const result = await dispatchUtterance('next', parseFn, {
      recorder: recorder as never,
      queue: queue as never,
      liveRegion,
      onPostMemo: vi.fn(),
    });

    expect(parseFn).toHaveBeenCalledWith('next');
    expect(result).toBe(CommandAction.NEXT_MEMO);
    expect(queue.next).toHaveBeenCalledTimes(1);
    liveRegion.remove();
  });

  it('returns null when the parser does not recognize the utterance', async () => {
    const liveRegion = document.createElement('div');
    document.body.appendChild(liveRegion);
    const recorder = makeFakeRecorder();
    const queue = makeFakeQueue();

    const parseFn = vi.fn().mockReturnValue(null);
    const onUnknownCommand = vi.fn();

    const result = await dispatchUtterance('what is the time', parseFn, {
      recorder: recorder as never,
      queue: queue as never,
      liveRegion,
      onPostMemo: vi.fn(),
      onUnknownCommand,
    });

    expect(result).toBeNull();
    expect(onUnknownCommand).toHaveBeenCalledTimes(1);
    liveRegion.remove();
  });
});
