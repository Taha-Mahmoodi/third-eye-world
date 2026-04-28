// Comments — Phase 4 task 2 per INSTRUCTIONS.md § 9.
//
// POST /api/memos/:id/comments  (multipart audio) → comment
// GET  /api/memos/:id/comments                    → [comment, ...]
// GET  /api/comments/:cid/audio                   → audio stream
//
// A comment is a memo attached to a parent memo. Same multipart contract
// as POST /api/memos (size cap, mime allow-list, server-generated UUID).
//
// Hard rules honored:
// - § 13: zod-validated where applicable, parameterized SQL, multipart
//   limits enforced at the route, rate-limited globally.
// - § 16: comments are immutable like memos — no edit endpoint.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { DB } from '../db/client.js';
import {
  isAllowedMimeType,
  type AudioStore,
} from '../lib/audio-store.js';
import { DEMO_USER_ID } from '../lib/demo-user.js';
import { MAX_AUDIO_BYTES } from './memos.js';

export interface CommentsRoutesOptions {
  db: DB;
  audioStore: AudioStore;
}

interface CommentRow {
  id: string;
  audio_path: string;
  mime_type: string;
  duration_ms: number | null;
  created_at: number;
  user_id: string;
  user_name: string;
}

export interface CommentResponse {
  id: string;
  user: { id: string; name: string };
  audio_url: string;
  mime_type: string;
  duration_ms: number | null;
  created_at: number;
}

function rowToResponse(row: CommentRow): CommentResponse {
  return {
    id: row.id,
    user: { id: row.user_id, name: row.user_name },
    audio_url: `/api/comments/${row.id}/audio`,
    mime_type: row.mime_type,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  };
}

export const commentsRoutes = (
  options: CommentsRoutesOptions,
): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function commentsRoutesPlugin(app: FastifyInstance) {
    const memoExists = options.db.prepare<[string], { id: string }>(
      'SELECT id FROM memos WHERE id = ?',
    );
    const insertComment = options.db.prepare(
      `INSERT INTO comments (id, memo_id, user_id, audio_path, mime_type, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const selectByMemo = options.db.prepare<[string], CommentRow>(
      `SELECT c.id, c.audio_path, c.mime_type, c.duration_ms, c.created_at,
              u.id AS user_id, u.name AS user_name
         FROM comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.memo_id = ?
        ORDER BY c.created_at ASC, c.id ASC`,
    );
    const selectAudio = options.db.prepare<
      [string],
      { audio_path: string; mime_type: string }
    >('SELECT audio_path, mime_type FROM comments WHERE id = ?');

    app.post<{ Params: { id: string } }>(
      '/api/memos/:id/comments',
      async (request, reply) => {
        const memoId = request.params.id;
        if (!memoExists.get(memoId)) {
          return reply.code(404).send({
            error: 'memo_not_found',
            message: 'No memo with that id.',
          });
        }

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
          request.log.warn({ err }, 'failed to read uploaded comment audio');
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
        const id = randomUUID();
        const createdAt = Date.now();

        insertComment.run(
          id,
          memoId,
          DEMO_USER_ID,
          relativePath,
          file.mimetype,
          null,
          createdAt,
        );

        // Read back so the response includes user info via the join.
        const row = options.db
          .prepare<[string], CommentRow>(
            `SELECT c.id, c.audio_path, c.mime_type, c.duration_ms, c.created_at,
                    u.id AS user_id, u.name AS user_name
               FROM comments c
               JOIN users u ON u.id = c.user_id
              WHERE c.id = ?`,
          )
          .get(id);

        if (!row) {
          // Inserted then disappeared — race with a CASCADE delete.
          return reply.code(500).send({
            error: 'comment_lost',
            message: 'Comment was deleted before it could be returned.',
          });
        }

        return reply.code(201).send(rowToResponse(row));
      },
    );

    app.get<{ Params: { id: string } }>(
      '/api/memos/:id/comments',
      // eslint-disable-next-line @typescript-eslint/require-await
      async (request, reply) => {
        const memoId = request.params.id;
        if (!memoExists.get(memoId)) {
          return reply.code(404).send({
            error: 'memo_not_found',
            message: 'No memo with that id.',
          });
        }
        const rows = selectByMemo.all(memoId);
        return reply.send({ comments: rows.map(rowToResponse) });
      },
    );

    app.get<{ Params: { cid: string } }>(
      '/api/comments/:cid/audio',
      async (request, reply) => {
        const cid = request.params.cid;
        const row = selectAudio.get(cid);
        if (!row) {
          return reply.code(404).send({
            error: 'comment_not_found',
            message: 'No comment with that id.',
          });
        }

        let absolutePath: string;
        try {
          absolutePath = options.audioStore.resolveAbsolute(row.audio_path);
        } catch {
          request.log.error(
            { commentId: cid },
            'comment audio path traversal blocked',
          );
          return reply.code(404).send({
            error: 'comment_not_found',
            message: 'No comment with that id.',
          });
        }

        let stats;
        try {
          stats = await stat(absolutePath);
        } catch {
          request.log.error(
            { commentId: cid, audio_path: row.audio_path },
            'comment audio file missing on disk',
          );
          return reply.code(404).send({
            error: 'audio_missing',
            message: 'Audio file is no longer available.',
          });
        }

        return reply
          .type(row.mime_type)
          .header('Cache-Control', 'public, max-age=31536000, immutable')
          .header('Content-Length', String(stats.size))
          .send(createReadStream(absolutePath));
      },
    );
  };
