import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import { type SttClient, SttUpstreamError } from '../src/lib/whisper.js';

const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes-for-stt');

interface Ctx {
  app: FastifyInstance;
  tmpDir: string;
  transcribe: ReturnType<typeof vi.fn>;
}

async function makeCtx(opts: { withClient?: boolean } = {}): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-stt-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const ttsCache = await createTtsCache(join(tmpDir, 'tts-cache'));
  const transcribe = vi.fn();
  const sttClient: SttClient = { transcribe };
  const app = await buildServer({
    db,
    audioStore,
    ttsCache,
    ttsClient: null,
    ttsAllowedVoices: new Set(),
    llmClient: null,
    sttClient: opts.withClient === false ? null : sttClient,
    rateLimitPerMinute: 1_000_000,
  });
  await app.ready();
  return { app, tmpDir, transcribe };
}

function buildMultipart(
  fieldname: string,
  filename: string,
  mimeType: string,
  bytes: Buffer,
): { body: Buffer; headers: Record<string, string> } {
  const form = new FormData();
  form.append(fieldname, bytes, { filename, contentType: mimeType });
  const rawHeaders: unknown = form.getHeaders();
  return { body: form.getBuffer(), headers: rawHeaders as Record<string, string> };
}

describe('POST /api/stt', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns the transcript on a valid call', async () => {
    ctx = await makeCtx();
    ctx.transcribe.mockResolvedValueOnce('next memo');

    const { body, headers } = buildMultipart('audio', 'a.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ transcript: string }>().transcript).toBe('next memo');
    expect(ctx.transcribe).toHaveBeenCalledTimes(1);
    const call = ctx.transcribe.mock.calls[0]?.[0] as {
      audio: Buffer;
      mimeType: string;
    };
    expect(call.mimeType).toBe('audio/webm');
    expect(Buffer.isBuffer(call.audio)).toBe(true);
  });

  it('returns 503 stt_disabled when no client is configured', async () => {
    ctx = await makeCtx({ withClient: false });
    const { body, headers } = buildMultipart('audio', 'a.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: string }>().error).toBe('stt_disabled');
  });

  it('returns 502 stt_upstream when Whisper errors', async () => {
    ctx = await makeCtx();
    ctx.transcribe.mockRejectedValueOnce(new SttUpstreamError('500', 500));
    const { body, headers } = buildMultipart('audio', 'a.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: string }>().error).toBe('stt_upstream');
  });

  it('returns 415 for unsupported mime type', async () => {
    ctx = await makeCtx();
    const { body, headers } = buildMultipart('audio', 'a.txt', 'text/plain', Buffer.from('x'));
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(415);
  });

  it('returns 400 wrong_field when uploaded under a different field name', async () => {
    ctx = await makeCtx();
    const { body, headers } = buildMultipart('recording', 'a.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('wrong_field');
  });

  it('returns 413 when the audio exceeds 5MB', async () => {
    ctx = await makeCtx();
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1);
    const { body, headers } = buildMultipart('audio', 'big.webm', 'audio/webm', tooBig);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stt',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(413);
  });
});
