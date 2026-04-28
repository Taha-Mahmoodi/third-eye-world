// POST /api/memos — Phase 1 task 3.
//
// Accepts a single multipart/form-data 'audio' file, writes it via the
// audio store, and inserts a memos row. The user_id is the Phase-1
// hardcoded demo user (see lib/demo-user.ts) — Phase 6 swaps that for
// req.session.userId.
//
// Hard rules from INSTRUCTIONS.md § 13 enforced here:
// - All inputs validated (zod for the response shape; multipart limits for
//   the file).
// - File size capped at 5 MB (audio uploads cap; § 13).
// - Filenames server-generated (UUID via audio store).
// - Rate-limited per session (registered via @fastify/rate-limit).

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import {
  createAudioStore,
  isAllowedMimeType,
  type AudioStore,
} from '../lib/audio-store.js';
import { DEMO_USER_ID } from '../lib/demo-user.js';

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB — § 13

export interface MemosRoutesOptions {
  db: DB;
  audioStore: AudioStore;
}

export const memoSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  audio_path: z.string(),
  mime_type: z.string(),
  duration_ms: z.number().int().nullable(),
  created_at: z.number().int(),
});

export type Memo = z.infer<typeof memoSchema>;

export const memosRoutes = (options: MemosRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function memosRoutesPlugin(app: FastifyInstance) {
    app.post('/api/memos', async (request, reply) => {
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
        // toBuffer() throws when multipart limits are exceeded. The error
        // surface from @fastify/multipart varies by version; match on either
        // the class name or the standard FastifyError code.
        if (err instanceof Error) {
          const errCode =
            (err as Error & { code?: string }).code ?? '';
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
        request.log.warn({ err }, 'failed to read uploaded audio');
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

      const relativePath = await options.audioStore.save(bytes, file.mimetype);
      const memo: Memo = {
        id: randomUUID(),
        user_id: DEMO_USER_ID,
        audio_path: relativePath,
        mime_type: file.mimetype,
        duration_ms: null,
        created_at: Date.now(),
      };

      options.db
        .prepare(
          `INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          memo.id,
          memo.user_id,
          memo.audio_path,
          memo.mime_type,
          memo.duration_ms,
          memo.created_at,
        );

      return reply.code(201).send(memo);
    });
  };

// Re-exported for tests so they can spin up an isolated audio store.
export { createAudioStore };
