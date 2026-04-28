import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { speak } from './speak.js';
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

describe('speak()', () => {
  let synth: FakeSynthesis;
  let liveRegion: HTMLDivElement;

  beforeEach(() => {
    synth = makeSynthesis();
    FakeUtterance.instances = [];
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    liveRegion.remove();
  });

  it('updates the live region with the phrase from strings.ts', () => {
    speak('RECORDING_POSTED', { liveRegion });
    expect(liveRegion.textContent).toBe(STRINGS.RECORDING_POSTED);
  });

  it('fires SpeechSynthesis.speak with the same phrase', () => {
    speak('RECORDING_POSTED', { liveRegion });

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(FakeUtterance.instances).toHaveLength(1);
    expect(FakeUtterance.instances[0]?.text).toBe(STRINGS.RECORDING_POSTED);
  });

  it('cancels prior utterances before speaking the new one', () => {
    speak('RECORDING_STARTED', { liveRegion });
    speak('RECORDING_POSTED', { liveRegion });

    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it('still updates the live region when SpeechSynthesis is unavailable', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);

    speak('FEED_EMPTY', { liveRegion });

    expect(liveRegion.textContent).toBe(STRINGS.FEED_EMPTY);
  });

  it('honors textOverride when provided', () => {
    speak('PLAYBACK_NEXT', { liveRegion, textOverride: 'Memo from Asha.' });

    expect(liveRegion.textContent).toBe('Memo from Asha.');
    expect(FakeUtterance.instances[0]?.text).toBe('Memo from Asha.');
  });

  it('is a no-op for the live region if none is supplied (still calls TTS)', () => {
    speak('PLAYBACK_ALL_DONE');

    expect(liveRegion.textContent).toBe('');
    expect(synth.speak).toHaveBeenCalledTimes(1);
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
