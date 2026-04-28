// LLM tool-call schema — Phase 5 task 3.
//
// Mirrors docs/llm-tools.md and CommandAction. Adding a new action requires
// a row in .claude/skills/voice-grammar/SKILL.md, an entry in
// CommandAction (client/src/commands/registry.ts), and a tool below.
//
// All inputs validated with zod before reaching the dispatcher (§ 13).

import { z } from 'zod';

export const SPEAK_PHRASE_MAX_LEN = 200;

const noArgs = z.object({}).strict();
const memoIdArgs = z.object({ memo_id: z.string().min(1) }).strict();

const speakArgs = z
  .object({
    phrase: z.string().min(1).max(SPEAK_PHRASE_MAX_LEN),
  })
  .strict();

/** OpenAI-compatible tool call (with arguments JSON-stringified by the
 *  upstream API) → discriminated union after parsing. */
export const llmToolCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('record_memo'), arguments: noArgs }),
  z.object({ name: z.literal('post_recording'), arguments: noArgs }),
  z.object({ name: z.literal('next_memo'), arguments: noArgs }),
  z.object({ name: z.literal('previous_memo'), arguments: noArgs }),
  z.object({ name: z.literal('pause'), arguments: noArgs }),
  z.object({ name: z.literal('resume'), arguments: noArgs }),
  z.object({ name: z.literal('like_memo'), arguments: memoIdArgs }),
  z.object({ name: z.literal('unlike_memo'), arguments: memoIdArgs }),
  z.object({ name: z.literal('start_comment'), arguments: memoIdArgs }),
  z.object({ name: z.literal('cancel'), arguments: noArgs }),
  z.object({ name: z.literal('speak_help'), arguments: noArgs }),
  z.object({ name: z.literal('speak'), arguments: speakArgs }),
]);

export type LlmToolCall = z.infer<typeof llmToolCallSchema>;

export const llmResponseSchema = z.object({
  tool_calls: z.array(llmToolCallSchema).min(1, 'tool_calls cannot be empty'),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

/** OpenAI-style tool definitions, sent to the upstream LLM in the
 *  `tools` field of the chat completion request. */
export const LLM_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'record_memo',
      description: 'Start recording a top-level memo.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'post_recording',
      description: 'Stop the current recording and post it.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'next_memo',
      description: 'Skip to the next memo in the feed.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'previous_memo',
      description: 'Go back one memo.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause',
      description: 'Pause playback.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume',
      description: 'Resume playback.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'like_memo',
      description: 'Like the memo with the given id.',
      parameters: {
        type: 'object',
        properties: { memo_id: { type: 'string' } },
        required: ['memo_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unlike_memo',
      description: 'Unlike the memo with the given id.',
      parameters: {
        type: 'object',
        properties: { memo_id: { type: 'string' } },
        required: ['memo_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_comment',
      description: 'Begin recording a reply to the memo with the given id.',
      parameters: {
        type: 'object',
        properties: { memo_id: { type: 'string' } },
        required: ['memo_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel',
      description: 'Universal kill switch — cancels recording, playback, comment-pending.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speak_help',
      description: 'Speak the v1 command list.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speak',
      description:
        'Speak a 1-2 short-sentence reply, max 200 chars, no markdown/emoji/parens. Required on every response.',
      parameters: {
        type: 'object',
        properties: { phrase: { type: 'string', maxLength: SPEAK_PHRASE_MAX_LEN } },
        required: ['phrase'],
        additionalProperties: false,
      },
    },
  },
] as const;

/** Reads OpenAI-style tool calls (with stringified arguments) and returns a
 *  validated typed response. Throws if the payload doesn't match. */
export function parseUpstreamToolCalls(
  raw: ReadonlyArray<{ name: string; arguments: string }>,
): LlmResponse {
  const parsed = raw.map((c) => {
    let args: unknown = {};
    if (c.arguments && c.arguments.trim() !== '') {
      try {
        args = JSON.parse(c.arguments);
      } catch (err) {
        throw new Error(
          `LLM tool call "${c.name}" had non-JSON arguments: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { name: c.name, arguments: args };
  });
  return llmResponseSchema.parse({ tool_calls: parsed });
}
