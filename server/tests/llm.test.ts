import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import {
  type LlmClient,
  LlmTimeoutError,
  LlmUpstreamError,
} from '../src/llm/client.js';
import {
  llmResponseSchema,
  parseUpstreamToolCalls,
} from '../src/llm/tools.js';

interface Ctx {
  app: FastifyInstance;
  tmpDir: string;
  complete: ReturnType<typeof vi.fn>;
}

async function makeCtx(opts: { withClient?: boolean } = {}): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-llm-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const ttsCache = await createTtsCache(join(tmpDir, 'tts-cache'));
  const complete = vi.fn();
  const llmClient: LlmClient = { complete };
  const app = await buildServer({
    db,
    audioStore,
    ttsCache,
    ttsClient: null,
    ttsAllowedVoices: new Set(),
    llmClient: opts.withClient === false ? null : llmClient,
    rateLimitPerMinute: 1_000_000,
  });
  await app.ready();
  return { app, tmpDir, complete };
}

describe('POST /api/llm', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns 503 llm_disabled when no LLM client is configured', async () => {
    ctx = await makeCtx({ withClient: false });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { transcript: 'next memo' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: string }>().error).toBe('llm_disabled');
  });

  it('returns the dispatched response on a successful call', async () => {
    ctx = await makeCtx();
    ctx.complete.mockResolvedValueOnce({
      tool_calls: [
        { name: 'next_memo', arguments: {} },
        { name: 'speak', arguments: { phrase: 'Next memo.' } },
      ],
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { transcript: 'next' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      speak_text: string;
      client_actions: Array<{ name: string }>;
      executed: Array<{ name: string }>;
    }>();
    expect(body.speak_text).toBe('Next memo.');
    expect(body.client_actions.map((c) => c.name)).toEqual(['next_memo']);
    expect(body.executed).toEqual([]);
  });

  it('passes the system prompt + transcript to the client', async () => {
    ctx = await makeCtx();
    ctx.complete.mockResolvedValueOnce({
      tool_calls: [{ name: 'speak', arguments: { phrase: 'Hi.' } }],
    });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: {
        transcript: 'help',
        context: { current_memo: { id: 'memo-42', user_name: 'Asha' } },
      },
    });

    expect(ctx.complete).toHaveBeenCalledTimes(1);
    const call = ctx.complete.mock.calls[0]?.[0] as {
      systemPrompt: string;
      transcript: string;
    };
    expect(call.transcript).toBe('help');
    expect(call.systemPrompt).toContain('memo id memo-42 from Asha');
  });

  it('returns 504 llm_timeout on LlmTimeoutError', async () => {
    ctx = await makeCtx();
    ctx.complete.mockRejectedValueOnce(new LlmTimeoutError('exceeded 2000ms'));

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { transcript: 'next' },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json<{ error: string }>().error).toBe('llm_timeout');
  });

  it('returns 502 llm_upstream on LlmUpstreamError', async () => {
    ctx = await makeCtx();
    ctx.complete.mockRejectedValueOnce(new LlmUpstreamError('LLM returned 500', 500));

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { transcript: 'next' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: string }>().error).toBe('llm_upstream');
  });

  it('returns 400 invalid_request when transcript is missing', async () => {
    ctx = await makeCtx();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { context: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_request');
  });

  it('returns 400 when transcript exceeds 1000 chars', async () => {
    ctx = await makeCtx();
    const long = 'a'.repeat(1_001);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/llm',
      payload: { transcript: long },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('parseUpstreamToolCalls', () => {
  it('parses OpenAI-style stringified arguments', () => {
    const result = parseUpstreamToolCalls([
      { name: 'like_memo', arguments: '{"memo_id":"abc"}' },
      { name: 'speak', arguments: '{"phrase":"Liked."}' },
    ]);
    expect(result.tool_calls).toEqual([
      { name: 'like_memo', arguments: { memo_id: 'abc' } },
      { name: 'speak', arguments: { phrase: 'Liked.' } },
    ]);
  });

  it('rejects an unknown tool name', () => {
    expect(() =>
      parseUpstreamToolCalls([{ name: 'nuke_database', arguments: '{}' }]),
    ).toThrow();
  });

  it('rejects a speak phrase over 200 chars', () => {
    const long = 'a'.repeat(201);
    expect(() =>
      parseUpstreamToolCalls([
        { name: 'speak', arguments: JSON.stringify({ phrase: long }) },
      ]),
    ).toThrow();
  });

  it('rejects like_memo without memo_id', () => {
    expect(() =>
      parseUpstreamToolCalls([{ name: 'like_memo', arguments: '{}' }]),
    ).toThrow();
  });

  it('treats empty argument string as {}', () => {
    const result = parseUpstreamToolCalls([
      { name: 'next_memo', arguments: '' },
      { name: 'speak', arguments: '{"phrase":"Next."}' },
    ]);
    expect(result.tool_calls[0]).toEqual({ name: 'next_memo', arguments: {} });
  });
});

describe('llmResponseSchema', () => {
  it('rejects an empty tool_calls array (every response must speak)', () => {
    const result = llmResponseSchema.safeParse({ tool_calls: [] });
    expect(result.success).toBe(false);
  });
});
