import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { createAudioStore, type AudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import { DEMO_USER_ID } from '../src/lib/demo-user.js';

const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes-for-comment');

interface Ctx {
  app: FastifyInstance;
  db: DB;
  audioStore: AudioStore;
  tmpDir: string;
}

async function makeCtx(): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-comments-'));
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
  return { app, db, audioStore, tmpDir };
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

function seedMemo(db: DB, id: string): void {
  db.prepare(
    `INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, DEMO_USER_ID, `${id}.webm`, 'audio/webm', null, Date.now());
}

interface CommentJson {
  id: string;
  user: { id: string; name: string };
  audio_url: string;
  mime_type: string;
  duration_ms: number | null;
  created_at: number;
}

describe('POST /api/memos/:id/comments', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeCtx();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns 201 with the new comment for a valid upload', async () => {
    seedMemo(ctx.db, 'm-1');
    const { body, headers } = buildMultipart('audio', 'reply.webm', 'audio/webm', SAMPLE_AUDIO);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/m-1/comments',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    const comment = response.json<CommentJson>();
    expect(comment.user).toEqual({ id: DEMO_USER_ID, name: 'Demo' });
    expect(comment.mime_type).toBe('audio/webm');
    expect(comment.audio_url).toBe(`/api/comments/${comment.id}/audio`);
  });

  it('writes the audio bytes to disk and the comment row to the DB', async () => {
    seedMemo(ctx.db, 'm-1');
    const { body, headers } = buildMultipart('audio', 'reply.webm', 'audio/webm', SAMPLE_AUDIO);

    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/m-1/comments',
      payload: body,
      headers,
    });
    const comment = upload.json<CommentJson>();

    const row = ctx.db
      .prepare<[string], { id: string; memo_id: string }>(
        'SELECT id, memo_id FROM comments WHERE id = ?',
      )
      .get(comment.id);
    expect(row).toEqual({ id: comment.id, memo_id: 'm-1' });

    const audioRow = ctx.db
      .prepare<[string], { audio_path: string }>(
        'SELECT audio_path FROM comments WHERE id = ?',
      )
      .get(comment.id);
    if (!audioRow) throw new Error('audio row missing');
    const onDisk = await readFile(ctx.audioStore.resolveAbsolute(audioRow.audio_path));
    expect(onDisk.equals(SAMPLE_AUDIO)).toBe(true);
  });

  it('returns 404 for an unknown memo id', async () => {
    const { body, headers } = buildMultipart('audio', 'r.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/does-not-exist/comments',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toBe('memo_not_found');
  });

  it('returns 415 for an unsupported mime type', async () => {
    seedMemo(ctx.db, 'm-1');
    const { body, headers } = buildMultipart('audio', 'r.txt', 'text/plain', Buffer.from('x'));
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/m-1/comments',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(415);
  });

  it('returns 413 when the file exceeds 5MB', async () => {
    seedMemo(ctx.db, 'm-1');
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1);
    const { body, headers } = buildMultipart('audio', 'big.webm', 'audio/webm', tooBig);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/m-1/comments',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(413);
  });
});

describe('GET /api/memos/:id/comments', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeCtx();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns the comments oldest-first with the user joined in', async () => {
    seedMemo(ctx.db, 'm-1');

    const insertComment = ctx.db.prepare(
      `INSERT INTO comments (id, memo_id, user_id, audio_path, mime_type, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertComment.run('c-1', 'm-1', DEMO_USER_ID, 'c1.webm', 'audio/webm', null, 100);
    insertComment.run('c-2', 'm-1', DEMO_USER_ID, 'c2.webm', 'audio/webm', null, 200);
    insertComment.run('c-3', 'm-1', DEMO_USER_ID, 'c3.webm', 'audio/webm', null, 300);

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos/m-1/comments',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ comments: CommentJson[] }>();
    expect(body.comments.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
  });

  it('returns an empty list when the memo has no comments', async () => {
    seedMemo(ctx.db, 'm-1');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos/m-1/comments',
    });
    expect(response.json<{ comments: CommentJson[] }>().comments).toEqual([]);
  });

  it('returns 404 for an unknown memo id', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos/does-not-exist/comments',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/comments/:cid/audio', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeCtx();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('streams the audio bytes for a real comment', async () => {
    seedMemo(ctx.db, 'm-1');
    const { body, headers } = buildMultipart('audio', 'r.webm', 'audio/webm', SAMPLE_AUDIO);
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos/m-1/comments',
      payload: body,
      headers,
    });
    const comment = upload.json<CommentJson>();

    const stream = await ctx.app.inject({
      method: 'GET',
      url: `/api/comments/${comment.id}/audio`,
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('audio/webm');
    expect(Buffer.from(stream.rawPayload).equals(SAMPLE_AUDIO)).toBe(true);
  });

  it('returns 404 for an unknown comment id', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/comments/does-not-exist/audio',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toBe('comment_not_found');
  });
});

describe('comments cascade', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeCtx();
  });
  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('deleting the parent memo cascades to comments', () => {
    seedMemo(ctx.db, 'm-1');
    ctx.db
      .prepare(
        `INSERT INTO comments (id, memo_id, user_id, audio_path, mime_type, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('c-1', 'm-1', DEMO_USER_ID, 'c1.webm', 'audio/webm', null, Date.now());
    ctx.db.prepare('DELETE FROM memos WHERE id = ?').run('m-1');
    const count = ctx.db
      .prepare<unknown[], { count: number }>(
        'SELECT COUNT(*) AS count FROM comments',
      )
      .get([]);
    expect(count?.count).toBe(0);
  });
});
