import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { speak, _setSpeakOverrides, _resetSpeakOverrides } from './speak.js';
import { STRINGS } from '../strings.js';

interface FakeSynthesis {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

class FakeUtterance {
  static instances: FakeUtterance[] = [];

  text: string;
  rate = 1.0;
  pitch = 1.0;

  constructor(text: string) {
    this.text = text;
    FakeUtterance.instances.push(this);
  }
}

function makeSynthesis(): FakeSynthesis {
  return {
    speak: vi.fn(),
    cancel: vi.fn(),
  };
}

/** Wait for the audio-chain microtasks to flush. The chain awaits fetch
 *  + blob + URL.createObjectURL synchronously inside an async function;
 *  three microtask flushes is enough to reach the Web Speech fallback in
 *  the failing-fetch case. */
async function flushChain(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('speak() — sync behavior', () => {
  let synth: FakeSynthesis;
  let liveRegion: HTMLDivElement;

  beforeEach(() => {
    synth = makeSynthesis();
    FakeUtterance.instances = [];
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    // Fetch always rejects so the chain falls through to Web Speech in
    // these tests. The fallback-chain tests below cover the success path.
    _setSpeakOverrides({
      fetchImpl: vi.fn().mockRejectedValue(new Error('no fetch in test')),
    });

    liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
  });

  afterEach(() => {
    _resetSpeakOverrides();
    vi.unstubAllGlobals();
    liveRegion.remove();
  });

  it('updates the live region SYNCHRONOUSLY with the phrase from strings.ts', async () => {
    speak('RECORDING_POSTED', { liveRegion });
    // The aria-live update is synchronous so the screen reader announces
    // the phrase even if the audio chain stalls (§ 2 #3).
    expect(liveRegion.textContent).toBe(STRINGS.RECORDING_POSTED);
    // Flush so the in-flight (rejected) fetch finishes before teardown.
    await flushChain();
  });

  it('honors textOverride when provided', async () => {
    speak('PLAYBACK_NEXT', { liveRegion, textOverride: 'Memo from Asha.' });
    expect(liveRegion.textContent).toBe('Memo from Asha.');
    await flushChain();
  });

  it('is a no-op for the live region if none is supplied', async () => {
    speak('PLAYBACK_ALL_DONE');
    expect(liveRegion.textContent).toBe('');
    await flushChain();
  });
});

describe('speak() — fallback chain', () => {
  let synth: FakeSynthesis;
  let liveRegion: HTMLDivElement;
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    synth = makeSynthesis();
    FakeUtterance.instances = [];
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    liveRegion = document.createElement('div');
    document.body.appendChild(liveRegion);
  });

  afterEach(() => {
    _resetSpeakOverrides();
    vi.unstubAllGlobals();
    liveRegion.remove();
  });

  it('falls through to Web Speech when both fetch links fail', async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    _setSpeakOverrides({ fetchImpl });

    speak('RECORDING_POSTED', { liveRegion });
    await flushChain();

    // Both /audio/phrases/RECORDING_POSTED.mp3 AND /api/tts were tried.
    expect(fetchImpl).toHaveBeenCalledWith(
      '/audio/phrases/RECORDING_POSTED.mp3',
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/tts?text='),
      expect.any(Object),
    );

    // Web Speech (link 4) was the floor.
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(FakeUtterance.instances[0]?.text).toBe(STRINGS.RECORDING_POSTED);
  });

  it('falls through to Web Speech on 4xx from the pre-baked URL', async () => {
    fetchImpl = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404 }),
    );
    _setSpeakOverrides({ fetchImpl });

    speak('RECORDING_POSTED', { liveRegion });
    await flushChain();

    // Both fetch calls were attempted.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('skips link 1 (pre-baked) when textOverride is set (dynamic phrase)', async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    _setSpeakOverrides({ fetchImpl });

    speak('PLAYBACK_NEXT', {
      liveRegion,
      textOverride: 'Memo from Asha, posted two minutes ago.',
    });
    await flushChain();

    // Only /api/tts was called — pre-baked is for static phrases only.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/tts?text='),
      expect.any(Object),
    );
    expect(fetchImpl.mock.calls[0]?.[0]).toContain(
      encodeURIComponent('Memo from Asha, posted two minutes ago.'),
    );

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(FakeUtterance.instances[0]?.text).toBe(
      'Memo from Asha, posted two minutes ago.',
    );
  });

  it('honors audioUrl override and only tries that URL before Web Speech', async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    _setSpeakOverrides({ fetchImpl });

    speak('RECORDING_POSTED', {
      liveRegion,
      audioUrl: '/test/sample.mp3',
    });
    await flushChain();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/test/sample.mp3', expect.any(Object));
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('plays the pre-baked MP3 when fetch succeeds and audio ends cleanly', async () => {
    const audioElements: FakeAudio[] = [];

    class FakeAudio extends EventTarget {
      paused = true;
      currentTime = 0;
      src: string;

      constructor(src: string) {
        super();
        this.src = src;
        audioElements.push(this);
      }
      play(): Promise<void> {
        this.paused = false;
        // Simulate playback ending right away.
        queueMicrotask(() => this.dispatchEvent(new Event('ended')));
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }

    const fakeBlob = new Blob(['fake-mp3'], { type: 'audio/mpeg' });
    fetchImpl = vi.fn().mockResolvedValue(new Response(fakeBlob, { status: 200 }));
    _setSpeakOverrides({
      fetchImpl,
      audioConstructor: FakeAudio as unknown as typeof HTMLAudioElement,
    });

    speak('RECORDING_POSTED', { liveRegion });
    await flushChain();

    // Pre-baked succeeded → /api/tts was NOT called.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/audio/phrases/RECORDING_POSTED.mp3',
      expect.any(Object),
    );
    // Audio played → Web Speech was NOT called.
    expect(synth.speak).not.toHaveBeenCalled();
    expect(audioElements).toHaveLength(1);
  });

  it('falls through to /api/tts when pre-baked fails but proxy succeeds', async () => {
    const audioElements: FakeAudio[] = [];

    class FakeAudio extends EventTarget {
      paused = true;
      currentTime = 0;
      src: string;

      constructor(src: string) {
        super();
        this.src = src;
        audioElements.push(this);
      }
      play(): Promise<void> {
        this.paused = false;
        queueMicrotask(() => this.dispatchEvent(new Event('ended')));
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }

    const fakeBlob = new Blob(['fake-mp3'], { type: 'audio/mpeg' });
    fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 })) // pre-baked miss
      .mockResolvedValueOnce(new Response(fakeBlob, { status: 200 })); // /api/tts hit
    _setSpeakOverrides({
      fetchImpl,
      audioConstructor: FakeAudio as unknown as typeof HTMLAudioElement,
    });

    speak('RECORDING_POSTED', { liveRegion });
    await flushChain();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(audioElements).toHaveLength(1);
  });

  it('cancels prior Web Speech before new fallback', async () => {
    fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    _setSpeakOverrides({ fetchImpl });

    speak('RECORDING_STARTED', { liveRegion });
    await flushChain();
    speak('RECORDING_POSTED', { liveRegion });
    await flushChain();

    // cancel() called twice (once per Web Speech invocation).
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });
});

describe('STRINGS contract', () => {
  it('every phrase is at most 200 characters (§ 11 cap)', () => {
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(value.length, `STRINGS.${key} too long: ${value.length}`).toBeLessThanOrEqual(200);
    }
  });

  it('no phrase contains markdown, emojis, or parentheses (§ 12 tone rules)', () => {
    const forbidden = /[*_`~()[\]]|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(value, `STRINGS.${key} contains forbidden markdown/emoji/parens: ${value}`).not.toMatch(forbidden);
    }
  });
});
