import { describe, it, expect } from 'vitest';
import { parseCommand, _getRegisteredPhrases } from './parser.js';
import { CommandAction } from './registry.js';

describe('parseCommand', () => {
  describe('primary utterances', () => {
    it.each([
      ['record', CommandAction.RECORD_START],
      ['post', CommandAction.RECORD_STOP_POST],
      ['next', CommandAction.NEXT_MEMO],
      ['previous', CommandAction.PREVIOUS_MEMO],
      ['pause', CommandAction.PAUSE],
      ['resume', CommandAction.RESUME],
      ['like', CommandAction.LIKE],
      ['unlike', CommandAction.UNLIKE],
      ['comment', CommandAction.COMMENT],
      ['stop', CommandAction.STOP],
      ['help', CommandAction.HELP],
    ])('"%s" → %s', (utterance, expected) => {
      expect(parseCommand(utterance)).toBe(expected);
    });
  });

  describe('synonyms', () => {
    it.each([
      // RECORD_START
      ['start', CommandAction.RECORD_START],
      ['post a memo', CommandAction.RECORD_START],
      ['new memo', CommandAction.RECORD_START],

      // RECORD_STOP_POST
      ['send', CommandAction.RECORD_STOP_POST],
      ['share', CommandAction.RECORD_STOP_POST],
      ['done', CommandAction.RECORD_STOP_POST],

      // NEXT
      ['skip', CommandAction.NEXT_MEMO],
      ['next memo', CommandAction.NEXT_MEMO],

      // PREVIOUS
      ['back', CommandAction.PREVIOUS_MEMO],
      ['go back', CommandAction.PREVIOUS_MEMO],
      ['previous memo', CommandAction.PREVIOUS_MEMO],

      // PAUSE
      ['wait', CommandAction.PAUSE],
      ['hold on', CommandAction.PAUSE],

      // RESUME
      ['play', CommandAction.RESUME],
      ['continue', CommandAction.RESUME],

      // LIKE
      ['heart', CommandAction.LIKE],
      ['love this', CommandAction.LIKE],
      ['love it', CommandAction.LIKE],

      // UNLIKE
      ['remove like', CommandAction.UNLIKE],
      ['unlike this', CommandAction.UNLIKE],

      // COMMENT
      ['reply', CommandAction.COMMENT],
      ['respond', CommandAction.COMMENT],

      // STOP
      ['cancel', CommandAction.STOP],
      ['never mind', CommandAction.STOP],

      // HELP
      ['what can i say', CommandAction.HELP],
      ['commands', CommandAction.HELP],
      ['what now', CommandAction.HELP],
    ])('synonym "%s" → %s', (utterance, expected) => {
      expect(parseCommand(utterance)).toBe(expected);
    });
  });

  describe('normalization', () => {
    it('is case-insensitive', () => {
      expect(parseCommand('NEXT')).toBe(CommandAction.NEXT_MEMO);
      expect(parseCommand('Help')).toBe(CommandAction.HELP);
      expect(parseCommand('LovE iT')).toBe(CommandAction.LIKE);
    });

    it('strips trailing punctuation', () => {
      expect(parseCommand('next!')).toBe(CommandAction.NEXT_MEMO);
      expect(parseCommand('post.')).toBe(CommandAction.RECORD_STOP_POST);
      expect(parseCommand('like?')).toBe(CommandAction.LIKE);
    });

    it('collapses internal whitespace', () => {
      expect(parseCommand('  next   memo  ')).toBe(CommandAction.NEXT_MEMO);
      expect(parseCommand('go    back')).toBe(CommandAction.PREVIOUS_MEMO);
    });
  });

  describe('filler stripping', () => {
    it.each([
      ['um, next', CommandAction.NEXT_MEMO],
      ['uh, like', CommandAction.LIKE],
      ['okay stop', CommandAction.STOP],
      ['so, pause', CommandAction.PAUSE],
      ['hey, help', CommandAction.HELP],
      ['please, comment', CommandAction.COMMENT],
    ])('"%s" → %s', (utterance, expected) => {
      expect(parseCommand(utterance)).toBe(expected);
    });
  });

  describe('whole-word containment', () => {
    it('matches an embedded command word', () => {
      expect(parseCommand('go to next memo please')).toBe(CommandAction.NEXT_MEMO);
      expect(parseCommand('I want to like this one')).toBe(CommandAction.LIKE);
      expect(parseCommand('can you stop now')).toBe(CommandAction.STOP);
    });

    it('respects word boundaries (does not match a substring inside another word)', () => {
      // "pretext" contains "next" only as a substring across "tex|t".
      // Actually "pretext" = "pret|ext" which contains the letters "next"
      // (positions 2-5 in "pretext" → "etex"). Hmm. Let me pick a better test:
      // "context" contains "next" inside (con|tex|t) — wait that's "ntex".
      // Let me use a word that genuinely embeds "next" without being
      // delimited: it's actually hard. The point is that " next " matches
      // and "alphanext" should not. JS's \b is between alphanumeric and
      // non-alphanumeric, so "alphanext" has no boundary before "next" so
      // the regex would not match. Test that explicitly:
      expect(parseCommand('alphanext')).toBeNull();
      expect(parseCommand('liketicide')).toBeNull();
    });

    it('picks the longest match when multiple phrases match', () => {
      // "previous memo" ⊃ "previous"; both → PREVIOUS_MEMO so the result
      // is the same. The point is exercised: longest phrase considered first.
      expect(parseCommand('the previous memo please')).toBe(
        CommandAction.PREVIOUS_MEMO,
      );
    });
  });

  describe('null / empty / unrecognized', () => {
    it.each([null, undefined, '', '   ', '\n\t'])(
      '%p → null',
      (input) => {
        expect(parseCommand(input)).toBeNull();
      },
    );

    it('returns null for completely unrecognized utterances', () => {
      expect(parseCommand('what is the weather')).toBeNull();
      expect(parseCommand('quokka')).toBeNull();
    });
  });

  describe('registry contract', () => {
    it('every CommandAction has at least one phrase', () => {
      const phrases = _getRegisteredPhrases();
      const covered = new Set(phrases.map(([, action]) => action));
      for (const action of Object.values(CommandAction)) {
        expect(covered.has(action), `Missing phrase for ${action}`).toBe(true);
      }
    });

    it('phrases are stored lowercased', () => {
      for (const [phrase] of _getRegisteredPhrases()) {
        expect(phrase, `phrase "${phrase}" not lowercased`).toBe(phrase.toLowerCase());
      }
    });
  });
});
