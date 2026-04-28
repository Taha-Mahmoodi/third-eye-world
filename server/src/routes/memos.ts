// /api/memos routes — Phase 1 tasks 3 + 4.
//
// POST  /api/memos                — multipart audio upload
// GET   /api/memos?cursor=&limit= — newest-first feed with keyset pagination
//
// The user_id on POST is the Phase-1 hardcoded demo user (see
// lib/demo-user.ts). Phase 6 swaps that for req.session.userId.
//
// Hard rules from INSTRUCTIONS.md § 13 enforced here:
// - All inputs validated (zod for query params and response shape; multipart
//   limits for the file).
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

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

const listQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIST_LIMIT, `limit must be between 1 and ${MAX_LIST_LIMIT}`)
    .default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

export interface MemoListItem {
  id: string;
  user: { id: string; name: string };
  audio_url: string;
  mime_type: string;
  duration_ms: number | null;
  created_at: number;
}

interface MemoListRow {
  id: string;
  audio_path: string;
  mime_type: string;
  duration_ms: number | null;
  created_at: number;
  user_id: string;
  user_name: string;
}

interface CursorValue {
  createdAt: number;
  id: string;
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(`${value.createdAt}:${value.id}`, 'utf-8').toString('base64url');
}

function decodeCursor(input: string): CursorValue | null {
  try {
    const decoded = Buffer.from(input, 'base64url').toString('utf-8');
    const sepIndex = decoded.indexOf(':');
    if (sepIndex < 0) return null;
    const createdAt = Number(decoded.slice(0, sepIndex));
    const id = decoded.slice(sepIndex + 1);
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

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

    app.get('/api/memos', (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_query',
          message: parsed.error.errors[0]?.message ?? 'Invalid query parameters.',
        });
      }
      const { limit, cursor } = parsed.data;

      const decoded = cursor ? decodeCursor(cursor) : null;
      if (cursor && !decoded) {
        return reply.code(400).send({
          error: 'invalid_cursor',
          message: 'Cursor is malformed.',
        });
      }

      // Keyset pagination: newest first, ties broken by id DESC.
      const rows: MemoListRow[] = decoded
        ? options.db
            .prepare<
              [number, number, string, number],
              MemoListRow
            >(
              `SELECT m.id, m.audio_path, m.mime_type, m.duration_ms, m.created_at,
                      u.id AS user_id, u.name AS user_name
                 FROM memos m
                 JOIN users u ON u.id = m.user_id
                WHERE m.created_at < ?
                   OR (m.created_at = ? AND m.id < ?)
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT ?`,
            )
            .all(decoded.createdAt, decoded.createdAt, decoded.id, limit + 1)
        : options.db
            .prepare<[number], MemoListRow>(
              `SELECT m.id, m.audio_path, m.mime_type, m.duration_ms, m.created_at,
                      u.id AS user_id, u.name AS user_name
                 FROM memos m
                 JOIN users u ON u.id = m.user_id
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT ?`,
            )
            .all(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

      const memos: MemoListItem[] = page.map((row) => ({
        id: row.id,
        user: { id: row.user_id, name: row.user_name },
        audio_url: `/api/memos/${row.id}/audio`,
        mime_type: row.mime_type,
        duration_ms: row.duration_ms,
        created_at: row.created_at,
      }));

      return reply.send({ memos, next_cursor: nextCursor });
    });
  };

// Re-exported for tests so they can spin up an isolated audio store.
export { createAudioStore };
