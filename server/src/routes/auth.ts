// Auth routes — Phase 6 task 1.
//
// POST   /api/auth/signup — multipart audio (a recording of the user's
//                            name) → Whisper-transcribe (when configured)
//                            → INSERT user → set session cookie → {user}
// GET    /api/auth/me     — { user } from the signed cookie or 401
// POST   /api/auth/logout — clear cookie
//
// When no Whisper client is configured (OPENAI_API_KEY unset), signup
// still works but the user gets a placeholder name like "Listener" so
// the demo loop is not gated on having an STT key.
//
// Hard rules honored:
// - § 2 #9: API key never reaches the client; Whisper call goes through
//   the existing SttClient.
// - § 13: cookies are Secure (prod) + HttpOnly + SameSite=Lax + signed.
// - § 13: input validated (mime allow-list + 5MB cap on the audio).

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/client.js';
import { isAllowedMimeType } from '../lib/audio-store.js';
import { type SttClient, SttUpstreamError } from '../lib/whisper.js';
import {
  clearSession,
  readSession,
  writeSession,
  type SessionOptions,
} from '../lib/session.js';
import { MAX_AUDIO_BYTES } from './memos.js';

const NAME_MAX_LEN = 80;

export interface AuthRoutesOptions {
  db: DB;
  /** null when STT is disabled — signup still works with a placeholder
   *  name, so the demo isn't gated on an OpenAI key. */
  sttClient: SttClient | null;
  sessionOptions: SessionOptions;
}

interface UserRow {
  id: string;
  name: string;
  created_at: number;
}

function sanitizeName(raw: string): string {
  // Strip trailing punctuation Whisper sometimes emits ("Asha." → "Asha"),
  // collapse whitespace, cap length. Never reject — onboarding has to
  // succeed even on a noisy transcript.
  const trimmed = raw.trim().replace(/[.,!?;:]+$/g, '').replace(/\s+/g, ' ');
  if (trimmed.length === 0) return 'Listener';
  return trimmed.slice(0, NAME_MAX_LEN);
}

export const authRoutes = (options: AuthRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function authRoutesPlugin(app: FastifyInstance) {
    const insertUser = options.db.prepare(
      `INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)`,
    );
    const selectUser = options.db.prepare<[string], UserRow>(
      `SELECT id, name, created_at FROM users WHERE id = ?`,
    );

    app.post('/api/auth/signup', async (request, reply) => {
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
            errCode === 'FST_REQ_FILE_TOO_LARGE'
          ) {
            return reply.code(413).send({
              error: 'audio_too_large',
              message: `Audio exceeds the ${MAX_AUDIO_BYTES} byte limit.`,
            });
          }
        }
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

      // Whisper-transcribe the name when configured; otherwise default
      // to "Listener" so onboarding never gates on the STT key.
      let name = 'Listener';
      if (options.sttClient) {
        try {
          const transcript = await options.sttClient.transcribe({
            audio: bytes,
            mimeType: file.mimetype,
          });
          name = sanitizeName(transcript);
        } catch (err) {
          if (err instanceof SttUpstreamError) {
            request.log.warn(
              { upstream_status: err.upstreamStatus },
              'whisper failed during signup; using placeholder name',
            );
          } else {
            request.log.warn({ err }, 'whisper unexpected error during signup');
          }
          // Fall through with the default name. Signup succeeds either way.
        }
      }

      const userId = randomUUID();
      insertUser.run(userId, name, Date.now());
      writeSession(reply, userId, options.sessionOptions);
      return reply.code(201).send({ user: { id: userId, name } });
    });

    app.get('/api/auth/me', (request, reply) => {
      const session = readSession(request, options.sessionOptions);
      if (!session) {
        return reply.code(401).send({ error: 'no_session' });
      }
      const user = selectUser.get(session.userId);
      if (!user) {
        clearSession(reply);
        return reply.code(401).send({ error: 'no_session' });
      }
      return reply.send({ user });
    });

    app.post('/api/auth/logout', (_request, reply) => {
      clearSession(reply);
      return reply.send({ ok: true });
    });
  };
