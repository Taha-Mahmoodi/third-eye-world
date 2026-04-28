// POST /api/stt — Phase 5 task 5.
//
// Multipart audio in, { transcript } out. Holds OPENAI_API_KEY
// server-side; the browser never sees it (§ 2 #9).
//
// Failure modes:
// - No client configured  → 503 stt_disabled (client falls back to
//                                              the deterministic parser)
// - Upstream Whisper      → 502 stt_upstream  (same fallback)
// - Validation            → 4xx invalid_audio / 413 audio_too_large /
//                            415 unsupported_mime_type
//
// Hard rules from § 13 honored: file size cap, mime allow-list,
// rate-limited globally.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  type SttClient,
  SttUpstreamError,
} from '../lib/whisper.js';
import {
  isAllowedMimeType,
} from '../lib/audio-store.js';
import { MAX_AUDIO_BYTES } from './memos.js';

export interface SttRoutesOptions {
  /** null when OPENAI_API_KEY is unset — the route returns 503 in
   *  that case so the client falls through to the deterministic
   *  parser. */
  client: SttClient | null;
}

export const sttRoutes = (options: SttRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function sttRoutesPlugin(app: FastifyInstance) {
    app.post('/api/stt', async (request, reply) => {
      const file = await request.file({
        limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
      });

      if (!file) {
        return reply.code(400).send({
          error: 'missing_audio',
          message: 'No audio file in the request.',
        });
      }
      if (file.fieldname !== 'audio') {
        return reply.code(400).send({
          error: 'wrong_field',
          message: "Audio must be uploaded under the 'audio' field.",
        });
      }
      if (!isAllowedMimeType(file.mimetype)) {
        return reply.code(415).send({
          error: 'unsupported_mime_type',
          message: `Audio mime type '${file.mimetype}' is not supported.`,
        });
      }

      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch (err) {
        if (err instanceof Error) {
          const errCode = (err as Error & { code?: string }).code ?? '';
          if (
            err.name === 'RequestFileTooLargeError' ||
            errCode === 'FST_REQ_FILE_TOO_LARGE' ||
            errCode === 'FST_FILES_LIMIT'
          ) {
            return reply.code(413).send({
              error: 'audio_too_large',
              message: `Audio exceeds the ${MAX_AUDIO_BYTES} byte limit.`,
            });
          }
        }
        request.log.warn({ err }, 'failed to read uploaded stt audio');
        return reply.code(400).send({
          error: 'invalid_audio',
          message: 'Could not read the uploaded audio.',
        });
      }

      if (bytes.byteLength === 0) {
        return reply.code(400).send({
          error: 'empty_audio',
          message: 'Audio file is empty.',
        });
      }

      if (!options.client) {
        return reply.code(503).send({
          error: 'stt_disabled',
          message: 'Speech-to-text is not configured on the server',
        });
      }

      try {
        const transcript = await options.client.transcribe({
          audio: bytes,
          mimeType: file.mimetype,
        });
        return reply.send({ transcript });
      } catch (err) {
        if (err instanceof SttUpstreamError) {
          request.log.warn(
            { upstream_status: err.upstreamStatus },
            'stt upstream error',
          );
          return reply.code(502).send({
            error: 'stt_upstream',
            message: 'Speech-to-text upstream returned an error',
          });
        }
        request.log.error({ err }, 'stt unexpected failure');
        return reply.code(502).send({
          error: 'stt_upstream',
          message: 'Speech-to-text request failed',
        });
      }
    });
  };
