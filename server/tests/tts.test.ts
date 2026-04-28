import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import {
  type TtsClient,
  TtsUpstreamError,
} from '../src/lib/elevenlabs.js';
import {
  ttsCacheKey,
  DEFAULT_TTS_SETTINGS,
  canonicalSettingsJson,
} from '../src/lib/tts-cache.js';

const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const SAMPLE_BYTES = Buffer.from('fake-mp3-bytes-' + 'x'.repeat(80));

interface Ctx {
  app: FastifyInstance;
  ttsCacheDir: string;
  tmpDir: string;
  client: TtsClient;
  synthesize: ReturnType<typeof vi.fn>;
}

async function makeCtx(opts: {
  withApiKey?: boolean;
  upstreamReject?: TtsUpstreamError;
} = {}): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-tts-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const ttsCacheDir = join(tmpDir, 'tts-cache');
  const ttsCache = await createTtsCache(ttsCacheDir);

  const synthesize = vi.fn();
  if (opts.upstreamReject) {
    synthesize.mockRejectedValue(opts.upstreamReject);
  } else {
    synthesize.mockResolvedValue(SAMPLE_BYTES);
  }
  const client: TtsClient = { synthesize };

  const app = await buildServer({
    db,
    audioStore,
    ttsCache,
    ttsClient: opts.withApiKey === false ? null : client,
    ttsAllowedVoices: new Set([VOICE_ID]),
    rateLimitPerMinute: 1_000_000,
  });
  await app.ready();

  return { app, ttsCacheDir, tmpDir, client, synthesize };
}

describe('GET /api/tts', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  describe('happy path', () => {
    beforeEach(async () => {
      ctx = await makeCtx();
    });

    it('cache miss → calls ElevenLabs and streams the bytes back', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=${encodeURIComponent('Posted.')}&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('audio/mpeg');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(Buffer.from(response.rawPayload).equals(SAMPLE_BYTES)).toBe(true);
      expect(ctx.synthesize).toHaveBeenCalledTimes(1);
      expect(ctx.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Posted.',
          voiceId: VOICE_ID,
          modelId: 'eleven_multilingual_v2',
        }),
      );
    });

    it('writes the bytes to the cache and serves the second hit from disk', async () => {
      await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=${encodeURIComponent('Posted.')}&voice=${VOICE_ID}`,
      });
      const second = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=${encodeURIComponent('Posted.')}&voice=${VOICE_ID}`,
      });

      expect(second.statusCode).toBe(200);
      expect(Buffer.from(second.rawPayload).equals(SAMPLE_BYTES)).toBe(true);
      // Synthesize was only called on the first request — second was cached.
      expect(ctx.synthesize).toHaveBeenCalledTimes(1);
    });

    it('uses eleven_turbo_v2_5 when requested via ?model=', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=${encodeURIComponent('Hi.')}&voice=${VOICE_ID}&model=eleven_turbo_v2_5`,
      });

      expect(response.statusCode).toBe(200);
      expect(ctx.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'eleven_turbo_v2_5' }),
      );
    });
  });

  describe('validation', () => {
    beforeEach(async () => {
      ctx = await makeCtx();
    });

    it('rejects empty text', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe('invalid_text');
    });

    it('rejects text over 200 chars', async () => {
      const long = 'a'.repeat(201);
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=${encodeURIComponent(long)}&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe('invalid_text');
    });

    it('rejects a voice not in the allow-list', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello&voice=not-allowed-voice-id`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe('invalid_voice');
      expect(ctx.synthesize).not.toHaveBeenCalled();
    });

    it('rejects missing voice', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello`,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown model', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello&voice=${VOICE_ID}&model=eleven_made_up_v9`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('failure modes', () => {
    it('returns 503 tts_disabled when no API key is configured', async () => {
      ctx = await makeCtx({ withApiKey: false });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(503);
      expect(response.json<{ error: string }>().error).toBe('tts_disabled');
    });

    it('returns 502 tts_upstream when ElevenLabs returns an error', async () => {
      ctx = await makeCtx({
        upstreamReject: new TtsUpstreamError('ElevenLabs returned 401', 401),
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(502);
      expect(response.json<{ error: string }>().error).toBe('tts_upstream');
    });

    it('returns 502 tts_upstream when synthesize throws an unexpected error', async () => {
      ctx = await makeCtx();
      ctx.synthesize.mockRejectedValueOnce(new Error('socket reset'));

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/tts?text=hello&voice=${VOICE_ID}`,
      });

      expect(response.statusCode).toBe(502);
      expect(response.json<{ error: string }>().error).toBe('tts_upstream');
    });
  });
});

describe('ttsCacheKey', () => {
  it('produces a stable 64-char hex digest', () => {
    const key = ttsCacheKey('hello', VOICE_ID, 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when the text changes', () => {
    const a = ttsCacheKey('a', VOICE_ID, 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    const b = ttsCacheKey('b', VOICE_ID, 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    expect(a).not.toBe(b);
  });

  it('changes when the voice changes', () => {
    const a = ttsCacheKey('hi', 'voice-a', 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    const b = ttsCacheKey('hi', 'voice-b', 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    expect(a).not.toBe(b);
  });

  it('changes when the model changes', () => {
    const a = ttsCacheKey('hi', VOICE_ID, 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    const b = ttsCacheKey('hi', VOICE_ID, 'eleven_turbo_v2_5', DEFAULT_TTS_SETTINGS);
    expect(a).not.toBe(b);
  });

  it('changes when settings change', () => {
    const a = ttsCacheKey('hi', VOICE_ID, 'eleven_multilingual_v2', DEFAULT_TTS_SETTINGS);
    const b = ttsCacheKey('hi', VOICE_ID, 'eleven_multilingual_v2', {
      ...DEFAULT_TTS_SETTINGS,
      stability: 0.7,
    });
    expect(a).not.toBe(b);
  });

  it('produces canonical JSON regardless of settings key order', () => {
    const a = canonicalSettingsJson(DEFAULT_TTS_SETTINGS);
    const reordered = {
      use_speaker_boost: DEFAULT_TTS_SETTINGS.use_speaker_boost,
      style: DEFAULT_TTS_SETTINGS.style,
      stability: DEFAULT_TTS_SETTINGS.stability,
      similarity_boost: DEFAULT_TTS_SETTINGS.similarity_boost,
    };
    const b = canonicalSettingsJson(reordered);
    expect(a).toBe(b);
  });
});
