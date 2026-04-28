import { describe, it, expect, vi } from 'vitest';
import {
  keyToAction,
  isEditableTarget,
  KeyboardCommandHandler,
} from './keyboard.js';
import { CommandAction } from './registry.js';

function key(
  k: string,
  flags: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: k,
    shiftKey: flags.shift ?? false,
    ctrlKey: flags.ctrl ?? false,
    metaKey: flags.meta ?? false,
    altKey: flags.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
}

describe('keyToAction', () => {
  describe('static rules', () => {
    it.each([
      ['r', CommandAction.RECORD_START],
      ['Enter', CommandAction.RECORD_STOP_POST],
      ['ArrowRight', CommandAction.NEXT_MEMO],
      ['ArrowLeft', CommandAction.PREVIOUS_MEMO],
      ['l', CommandAction.LIKE],
      ['c', CommandAction.COMMENT],
      ['Escape', CommandAction.STOP],
      ['?', CommandAction.HELP],
    ])('%s → %s', (k, action) => {
      expect(keyToAction(key(k), false)).toBe(action);
    });

    it('Shift+L → UNLIKE', () => {
      expect(keyToAction(key('L', { shift: true }), false)).toBe(CommandAction.UNLIKE);
    });

    it('lowercase l (no Shift) is LIKE, not UNLIKE', () => {
      expect(keyToAction(key('l'), false)).toBe(CommandAction.LIKE);
    });
  });

  describe('Space toggles pause/resume based on isPlaying()', () => {
    it('Space + isPlaying=true → PAUSE', () => {
      expect(keyToAction(key(' '), true)).toBe(CommandAction.PAUSE);
    });
    it('Space + isPlaying=false → RESUME', () => {
      expect(keyToAction(key(' '), false)).toBe(CommandAction.RESUME);
    });
  });

  describe('modifier guards', () => {
    it.each([
      ['r', { ctrl: true }],
      ['r', { meta: true }],
      ['r', { alt: true }],
      ['l', { ctrl: true }],
      ['c', { meta: true }],
      ['Enter', { shift: true }],
    ] as const)('ignores %s with modifiers %j', (k, flags) => {
      expect(keyToAction(key(k, flags), false)).toBeNull();
    });

    it('does not require modifiers on Escape', () => {
      // Escape always means STOP — even with Shift held. The kill switch
      // (§ 2 #5) cannot be conditional.
      expect(keyToAction(key('Escape'), false)).toBe(CommandAction.STOP);
      expect(keyToAction(key('Escape', { shift: true }), false)).toBe(
        CommandAction.STOP,
      );
    });
  });

  it('returns null for unmapped keys', () => {
    expect(keyToAction(key('a'), false)).toBeNull();
    expect(keyToAction(key('1'), false)).toBeNull();
    expect(keyToAction(key('Tab'), false)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('returns true for input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = key('r');
    Object.defineProperty(event, 'target', { value: input });
    expect(isEditableTarget(event)).toBe(true);
    input.remove();
  });

  it('returns true for textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const event = key('r');
    Object.defineProperty(event, 'target', { value: ta });
    expect(isEditableTarget(event)).toBe(true);
    ta.remove();
  });

  it('returns true for contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    const event = key('r');
    Object.defineProperty(event, 'target', { value: div });
    expect(isEditableTarget(event)).toBe(true);
    div.remove();
  });

  it('returns false for a plain button', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const event = key('r');
    Object.defineProperty(event, 'target', { value: btn });
    expect(isEditableTarget(event)).toBe(false);
    btn.remove();
  });
});

describe('KeyboardCommandHandler', () => {
  it('dispatches the matched action on attach + keydown', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);

    document.dispatchEvent(key('l'));
    document.dispatchEvent(key('Escape'));

    expect(dispatch).toHaveBeenNthCalledWith(1, CommandAction.LIKE);
    expect(dispatch).toHaveBeenNthCalledWith(2, CommandAction.STOP);

    handler.detach();
  });

  it('ignores keys typed inside an input', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = key('l');
    Object.defineProperty(event, 'target', { value: input });
    document.dispatchEvent(event);

    expect(dispatch).not.toHaveBeenCalled();
    input.remove();
    handler.detach();
  });

  it('preventDefault is called for handled keys', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);

    const event = key(' '); // Space → RESUME
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    handler.detach();
  });

  it('does not preventDefault for unmapped keys', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);

    const event = key('Tab');
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    handler.detach();
  });

  it('respects shouldSkip', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
      shouldSkip: () => true,
    });
    handler.attach(document);

    document.dispatchEvent(key('l'));

    expect(dispatch).not.toHaveBeenCalled();
    handler.detach();
  });

  it('detach() stops dispatching', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);
    handler.detach();

    document.dispatchEvent(key('l'));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('attach is idempotent', () => {
    const dispatch = vi.fn();
    const handler = new KeyboardCommandHandler(dispatch, {
      isPlaying: () => false,
    });
    handler.attach(document);
    handler.attach(document); // second call is a no-op

    document.dispatchEvent(key('l'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    handler.detach();
  });
});
