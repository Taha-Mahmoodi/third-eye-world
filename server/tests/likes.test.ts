import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import { DEMO_USER_ID } from '../src/lib/demo-user.js';

interface Ctx {
  app: FastifyInstance;
  db: DB;
  tmpDir: string;
}

async function makeCtx(): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-likes-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const ttsCache = await createTtsCache(join(tmpDir, 'tts-cache'));
  const app = await buildServer({
    db,
    audioStore,
    ttsCache,
    ttsClient: null,
    ttsAllowedVoices: new Set(),
    rateLimitPerMinute: 1_000_000,
  });
  await app.ready();
  return { app, db, tmpDir };
}

function seedMemo(db: DB, id: string): void {
  db.prepare(
    `INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, DEMO_USER_ID, `${id}.webm`, 'audio/webm', null, Date.now());
}

describe('Likes routes', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await makeCtx();
  });

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  describe('POST /api/memos/:id/like', () => {
    it('returns { liked: true, count: 1 } for the first like', async () => {
      seedMemo(ctx.db, 'm-1');

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/memos/m-1/like',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ liked: boolean; count: number }>()).toEqual({
        liked: true,
        count: 1,
      });
    });

    it('is idempotent — re-liking does not increase the count', async () => {
      seedMemo(ctx.db, 'm-1');

      await ctx.app.inject({ method: 'POST', url: '/api/memos/m-1/like' });
      const second = await ctx.app.inject({
        method: 'POST',
        url: '/api/memos/m-1/like',
      });

      expect(second.statusCode).toBe(200);
      expect(second.json<{ count: number }>().count).toBe(1);
    });

    it('returns 404 for an unknown memo id', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/memos/does-not-exist/like',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: string }>().error).toBe('memo_not_found');
    });

    it('counts likes per memo independently', async () => {
      seedMemo(ctx.db, 'm-1');
      seedMemo(ctx.db, 'm-2');

      // Demo user likes m-1.
      await ctx.app.inject({ method: 'POST', url: '/api/memos/m-1/like' });
      // Insert another user + their like on m-1 to bump the count.
      ctx.db
        .prepare(
          `INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)`,
        )
        .run('u-2', 'Other', Date.now());
      ctx.db
        .prepare(
          `INSERT INTO likes (user_id, memo_id, created_at) VALUES (?, ?, ?)`,
        )
        .run('u-2', 'm-1', Date.now());

      const m1 = await ctx.app.inject({
        method: 'POST',
        url: '/api/memos/m-1/like',
      });
      expect(m1.json<{ count: number }>().count).toBe(2);

      const m2 = await ctx.app.inject({
        method: 'POST',
        url: '/api/memos/m-2/like',
      });
      expect(m2.json<{ count: number }>().count).toBe(1);
    });
  });

  describe('DELETE /api/memos/:id/like', () => {
    it('removes the like and returns { liked: false, count: 0 }', async () => {
      seedMemo(ctx.db, 'm-1');
      await ctx.app.inject({ method: 'POST', url: '/api/memos/m-1/like' });

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/memos/m-1/like',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ liked: boolean; count: number }>()).toEqual({
        liked: false,
        count: 0,
      });
    });

    it('is idempotent — un-liking when not liked is fine', async () => {
      seedMemo(ctx.db, 'm-1');

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/memos/m-1/like',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ count: number }>().count).toBe(0);
    });

    it('returns 404 for an unknown memo id', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/memos/does-not-exist/like',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('cascades — deleting a memo also deletes its likes', () => {
    seedMemo(ctx.db, 'm-1');
    ctx.db
      .prepare(
        `INSERT INTO likes (user_id, memo_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(DEMO_USER_ID, 'm-1', Date.now());

    ctx.db.prepare('DELETE FROM memos WHERE id = ?').run('m-1');

    const count = ctx.db
      .prepare<unknown[], { count: number }>(
        'SELECT COUNT(*) AS count FROM likes',
      )
      .get([]);
    expect(count?.count).toBe(0);
  });
});
