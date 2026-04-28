// GET /api/tts — ElevenLabs proxy.
//
// Phase 3 task 2 per INSTRUCTIONS.md § 9 + the elevenlabs-integration skill.
//
// Hard rules from § 2 enforced here:
// - #9 No API keys in client code: the API key lives in
//   ELEVENLABS_API_KEY, server-only. The browser only ever sees this proxy.
// - § 11 200-char cap on text. § 13 input validation via zod.
// - Path traversal blocked at the cache boundary.
//
// Failure modes (per the skill):
// - Missing API key       → 503 tts_disabled    (client falls back to Web Speech)
// - Upstream ElevenLabs   → 502 tts_upstream    (same fallback)
// - Validation            → 4xx invalid_text / invalid_voice
// - Voice not allow-listed → 400 invalid_voice

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_TTS_MODEL,
  type TtsClient,
  type TtsModelId,
  TtsUpstreamError,
} from '../lib/elevenlabs.js';
import {
  DEFAULT_TTS_SETTINGS,
  ttsCacheKey,
  type TtsCache,
  type TtsSettings,
} from '../lib/tts-cache.js';

export const TTS_TEXT_MAX_LEN = 200; // § 11

const ALLOWED_MODELS = ['eleven_multilingual_v2', 'eleven_turbo_v2_5'] as const;

const ttsQuerySchema = z.object({
  text: z
    .string()
    .min(1, 'text is required')
    .max(TTS_TEXT_MAX_LEN, `text must be ${TTS_TEXT_MAX_LEN} chars or fewer`),
  voice: z.string().min(1, 'voice is required'),
  model: z.enum(ALLOWED_MODELS).optional(),
});

export interface TtsRoutesOptions {
  /** null when ELEVENLABS_API_KEY is unset — the route returns 503 in
   *  that case so the client falls through to Web Speech. */
  client: TtsClient | null;
  cache: TtsCache;
  /** Voices the proxy will pass through to ElevenLabs. Always validated
   *  against this allow-list to prevent voice-id injection abuse. */
  allowedVoices: ReadonlySet<string>;
  defaultSettings?: TtsSettings;
}

export const ttsRoutes = (options: TtsRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function ttsRoutesPlugin(app: FastifyInstance) {
    const settings = options.defaultSettings ?? DEFAULT_TTS_SETTINGS;

    app.get('/api/tts', async (request, reply) => {
      const parsed = ttsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_text',
          message: parsed.error.errors[0]?.message ?? 'invalid query',
        });
      }
      const { text, voice, model } = parsed.data;
      const modelId: TtsModelId = model ?? DEFAULT_TTS_MODEL;

      if (!options.allowedVoices.has(voice)) {
        return reply.code(400).send({
          error: 'invalid_voice',
          message: 'voice is not allow-listed',
        });
      }

      const key = ttsCacheKey(text, voice, modelId, settings);

      // 1. Cache hit → stream from disk.
      if (await options.cache.has(key)) {
        return reply
          .type('audio/mpeg')
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .send(options.cache.readStream(key));
      }

      // 2. Cache miss + no API key → 503 so the client falls back to
      //    Web Speech. App stays audible (§ 2 #4).
      if (!options.client) {
        return reply.code(503).send({
          error: 'tts_disabled',
          message: 'TTS is not configured on the server',
        });
      }

      // 3. Cache miss + API key → call ElevenLabs.
      let bytes: Buffer;
      try {
        bytes = await options.client.synthesize({
          text,
          voiceId: voice,
          modelId,
          settings,
        });
      } catch (err) {
        if (err instanceof TtsUpstreamError) {
          request.log.warn(
            { upstream_status: err.upstreamStatus },
            'tts upstream error',
          );
          return reply.code(502).send({
            error: 'tts_upstream',
            message: 'TTS upstream returned an error',
          });
        }
        request.log.error({ err }, 'tts unexpected failure');
        return reply.code(502).send({
          error: 'tts_upstream',
          message: 'TTS request failed',
        });
      }

      // Save to cache before sending so the next identical request hits
      // disk. Failure to cache is non-fatal — log and serve anyway.
      try {
        await options.cache.save(key, bytes);
      } catch (err) {
        request.log.warn({ err, key }, 'tts cache write failed');
      }

      return reply
        .type('audio/mpeg')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Content-Length', String(bytes.byteLength))
        .send(bytes);
    });
  };
