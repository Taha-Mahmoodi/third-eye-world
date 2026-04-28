import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  SYSTEM_PROMPT_HEADER,
} from '../src/llm/system-prompt.js';

describe('SYSTEM_PROMPT_HEADER', () => {
  it('forbids markdown / emoji / parens in spoken phrases (§ 12)', () => {
    // The header itself describes the rule; assert the rule text is there.
    expect(SYSTEM_PROMPT_HEADER).toContain('No lists');
    expect(SYSTEM_PROMPT_HEADER).toContain('No markdown');
    expect(SYSTEM_PROMPT_HEADER).toContain('No parentheses');
    expect(SYSTEM_PROMPT_HEADER).toContain('No emojis');
  });

  it('forbids visual references (§ 19 — blind user is default)', () => {
    expect(SYSTEM_PROMPT_HEADER).toContain('Never reference visual elements');
  });

  it('forbids the AI-disclaimer pattern (third-eye-tone)', () => {
    expect(SYSTEM_PROMPT_HEADER).toContain('As an AI');
  });

  it('requires speak() on every response (§ 2 #3)', () => {
    expect(SYSTEM_PROMPT_HEADER).toContain('EVERY response includes exactly one `speak`');
  });

  it('caps speak() at 200 characters', () => {
    expect(SYSTEM_PROMPT_HEADER).toContain('200 characters');
  });
});

describe('buildSystemPrompt', () => {
  it('includes the canonical header', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('You are the host of Third Eye World');
  });

  it('reports "Currently playing: nothing." when no current memo', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Currently playing: nothing.');
  });

  it('reports the current memo id and author when one is provided', () => {
    const prompt = buildSystemPrompt({
      current_memo: { id: 'memo-abc-123', user_name: 'Asha' },
    });
    expect(prompt).toContain('memo id memo-abc-123 from Asha');
  });

  it('includes the listener name when provided', () => {
    const prompt = buildSystemPrompt({ user_name: 'Sam' });
    expect(prompt).toContain('Listener: Sam');
  });

  it('omits the Listener line when user_name is absent', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain('Listener:');
  });
});
