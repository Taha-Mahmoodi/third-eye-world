import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { createAudioStore, type AudioStore } from '../src/lib/audio-store.js';
import { DEMO_USER_ID } from '../src/lib/demo-user.js';

const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes-for-test');

async function makeApp(): Promise<{
  app: FastifyInstance;
  db: DB;
  audioStore: AudioStore;
  tmpDir: string;
}> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-memos-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const app = await buildServer({
    db,
    audioStore,
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
  // form-data's getHeaders() is typed as `any` in @types; the runtime shape
  // is { 'content-type': string }, so we narrow here at the boundary.
  const rawHeaders: unknown = form.getHeaders();
  const headers = rawHeaders as Record<string, string>;
  return {
    body: form.getBuffer(),
    headers,
  };
}

describe('POST /api/memos', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    ctx = await makeApp();
  });

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns 201 with the new memo when given a valid audio upload', async () => {
    const { body, headers } = buildMultipart(
      'audio',
      'memo.webm',
      'audio/webm',
      SAMPLE_AUDIO,
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    const memo = response.json<Record<string, unknown>>();
    expect(memo).toMatchObject({
      user_id: DEMO_USER_ID,
      mime_type: 'audio/webm',
      duration_ms: null,
    });
    expect(typeof memo.id).toBe('string');
    expect(typeof memo.audio_path).toBe('string');
    expect(typeof memo.created_at).toBe('number');
  });

  it('writes the audio bytes to the audio store and the row to the DB', async () => {
    const { body, headers } = buildMultipart(
      'audio',
      'memo.webm',
      'audio/webm',
      SAMPLE_AUDIO,
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });
    const memo = response.json<{ id: string; audio_path: string }>();

    // DB row exists.
    const row = ctx.db
      .prepare<unknown[], { id: string; audio_path: string }>(
        'SELECT id, audio_path FROM memos WHERE id = ?',
      )
      .get(memo.id);
    expect(row).toEqual({ id: memo.id, audio_path: memo.audio_path });

    // File exists on disk under the audio store root.
    const abs = ctx.audioStore.resolveAbsolute(memo.audio_path);
    const onDisk = await readFile(abs);
    expect(onDisk.equals(SAMPLE_AUDIO)).toBe(true);

    // Filename is server-generated (UUID + ext), not the user-supplied name.
    const filesInStore = await readdir(ctx.audioStore.rootDir);
    expect(filesInStore).toHaveLength(1);
    expect(filesInStore[0]).not.toBe('memo.webm');
    expect(filesInStore[0]).toMatch(/^[0-9a-f-]{36}\.webm$/);
  });

  it('returns 400 when no file is uploaded', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: '',
      headers: {
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toEqual(expect.any(String));
  });

  it("returns 400 when the file is uploaded under the wrong field name", async () => {
    const { body, headers } = buildMultipart(
      'recording',
      'memo.webm',
      'audio/webm',
      SAMPLE_AUDIO,
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'wrong_field' });
  });

  it('returns 415 when the mime type is not in the allow-list', async () => {
    const { body, headers } = buildMultipart(
      'audio',
      'memo.txt',
      'text/plain',
      Buffer.from('hello world'),
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ error: 'unsupported_mime_type' });
  });

  it('returns 413 when the file exceeds the 5 MB cap', async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1);
    const { body, headers } = buildMultipart(
      'audio',
      'huge.webm',
      'audio/webm',
      tooBig,
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(413);
  });

  it('does not write a DB row when the upload is rejected', async () => {
    const { body, headers } = buildMultipart(
      'audio',
      'bad.txt',
      'text/plain',
      Buffer.from('nope'),
    );

    await ctx.app.inject({
      method: 'POST',
      url: '/api/memos',
      payload: body,
      headers,
    });

    const count = ctx.db
      .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM memos')
      .get([]);
    expect(count?.count).toBe(0);
  });
});

interface MemoListResponse {
  memos: Array<{
    id: string;
    user: { id: string; name: string };
    audio_url: string;
    mime_type: string;
    duration_ms: number | null;
    created_at: number;
  }>;
  next_cursor: string | null;
}

function seedMemos(db: DB, count: number, baseTime: number): void {
  // Seeded with a stable created_at so tests are deterministic.
  const stmt = db.prepare(
    `INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    stmt.run(
      `m-${String(i).padStart(3, '0')}`,
      DEMO_USER_ID,
      `dummy-${i}.webm`,
      'audio/webm',
      null,
      baseTime + i,
    );
  }
}

describe('GET /api/memos', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;

  beforeEach(async () => {
    ctx = await makeApp();
  });

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns an empty list when no memos exist', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/memos' });

    expect(response.statusCode).toBe(200);
    expect(response.json<MemoListResponse>()).toEqual({
      memos: [],
      next_cursor: null,
    });
  });

  it('returns memos newest-first with the user joined in', async () => {
    seedMemos(ctx.db, 3, 1_000_000);

    const response = await ctx.app.inject({ method: 'GET', url: '/api/memos' });
    const body = response.json<MemoListResponse>();

    expect(response.statusCode).toBe(200);
    expect(body.memos).toHaveLength(3);
    // Newest first → m-002, m-001, m-000.
    expect(body.memos.map((m) => m.id)).toEqual(['m-002', 'm-001', 'm-000']);
    expect(body.memos[0]).toMatchObject({
      user: { id: DEMO_USER_ID, name: 'Demo' },
      audio_url: '/api/memos/m-002/audio',
      mime_type: 'audio/webm',
      duration_ms: null,
      created_at: 1_000_002,
    });
    expect(body.next_cursor).toBeNull();
  });

  it('honors a custom limit and returns a next_cursor when more remain', async () => {
    seedMemos(ctx.db, 5, 1_000_000);

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos?limit=2',
    });
    const body = response.json<MemoListResponse>();

    expect(response.statusCode).toBe(200);
    expect(body.memos.map((m) => m.id)).toEqual(['m-004', 'm-003']);
    expect(body.next_cursor).not.toBeNull();
  });

  it('paginates correctly across multiple pages with the cursor', async () => {
    seedMemos(ctx.db, 5, 1_000_000);

    const page1 = (
      await ctx.app.inject({ method: 'GET', url: '/api/memos?limit=2' })
    ).json<MemoListResponse>();

    const page2 = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/memos?limit=2&cursor=${encodeURIComponent(page1.next_cursor ?? '')}`,
      })
    ).json<MemoListResponse>();

    const page3 = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/memos?limit=2&cursor=${encodeURIComponent(page2.next_cursor ?? '')}`,
      })
    ).json<MemoListResponse>();

    expect(page1.memos.map((m) => m.id)).toEqual(['m-004', 'm-003']);
    expect(page2.memos.map((m) => m.id)).toEqual(['m-002', 'm-001']);
    expect(page3.memos.map((m) => m.id)).toEqual(['m-000']);
    expect(page3.next_cursor).toBeNull();
  });

  it('returns 400 on a malformed cursor', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos?cursor=this-is-not-base64-or-anything',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_cursor');
  });

  it('rejects a non-positive limit', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos?limit=0',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_query');
  });

  it('rejects a limit above the cap', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/memos?limit=500',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('invalid_query');
  });
});
