import { describe, it, expect, vi } from 'vitest';
import { routeViaLlm } from './llm-pipeline.js';
import { CommandAction } from '../commands/registry.js';

describe('routeViaLlm', () => {
  it('returns null when fetch is unavailable', async () => {
    // No fetchImpl override and globalThis.fetch may not be set in some envs.
    // Pass an explicit override that throws to simulate offline.
    const result = await routeViaLlm(
      'next',
      {},
      {
        fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
      },
    );
    expect(result.status).toBe('errored');
  });

  it('returns disabled on 503 (LLM not configured — no degraded message)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'llm_disabled' }), {
        status: 503,
      }),
    );
    const result = await routeViaLlm('next', {}, { fetchImpl });
    expect(result.status).toBe('disabled');
  });

  it('returns null on 504 (timeout — falls back)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'llm_timeout' }), { status: 504 }),
    );
    const result = await routeViaLlm('next', {}, { fetchImpl });
    expect(result.status).toBe('errored');
  });

  it('returns null on 502 (upstream / dispatch — falls back)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'llm_upstream' }), { status: 502 }),
    );
    const result = await routeViaLlm('next', {}, { fetchImpl });
    expect(result.status).toBe('errored');
  });

  it('translates client_actions tool names into CommandActions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          speak_text: 'Next memo.',
          client_actions: [{ name: 'next_memo' }],
          executed: [],
        }),
        { status: 200 },
      ),
    );
    const result = await routeViaLlm('next', {}, { fetchImpl });
    expect(result).toEqual({
      status: 'ok',
      result: {
        speak_text: 'Next memo.',
        actions: [CommandAction.NEXT_MEMO],
        executed: [],
      },
    });
  });

  it('preserves order across multiple client_actions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          speak_text: 'Paused. Help.',
          client_actions: [{ name: 'pause' }, { name: 'speak_help' }],
          executed: [],
        }),
        { status: 200 },
      ),
    );
    const result = await routeViaLlm('pause and help', {}, { fetchImpl });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.result.actions).toEqual([
      CommandAction.PAUSE,
      CommandAction.HELP,
    ]);
  });

  it('exposes server-executed tools in result.executed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          speak_text: 'Liked.',
          client_actions: [],
          executed: [{ name: 'like_memo' }],
        }),
        { status: 200 },
      ),
    );
    const result = await routeViaLlm('like this', {}, { fetchImpl });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.result.executed).toEqual(['like_memo']);
    expect(result.result.actions).toEqual([]);
  });

  it('drops unknown tool names silently', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          speak_text: 'Hi.',
          client_actions: [{ name: 'future_unknown_tool' }, { name: 'pause' }],
          executed: [],
        }),
        { status: 200 },
      ),
    );
    const result = await routeViaLlm('hi', {}, { fetchImpl });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.result.actions).toEqual([CommandAction.PAUSE]);
  });

  it('sends the context (current_memo) to /api/llm', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          speak_text: 'Liked.',
          client_actions: [],
          executed: [],
        }),
        { status: 200 },
      ),
    );
    await routeViaLlm(
      'like it',
      { current_memo: { id: 'memo-42', user_name: 'Asha' } },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    const url = call?.[0] as unknown;
    const init = call?.[1] as { body?: string } | undefined;
    expect(url).toBe('/api/llm');
    const body = JSON.parse(init?.body ?? '{}') as {
      transcript: string;
      context: { current_memo?: { id: string } };
    };
    expect(body.transcript).toBe('like it');
    expect(body.context.current_memo?.id).toBe('memo-42');
  });

  it('returns null on unexpected response shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ wrong_shape: 1 }), { status: 200 }),
    );
    const result = await routeViaLlm('next', {}, { fetchImpl });
    expect(result.status).toBe('errored');
  });
});
