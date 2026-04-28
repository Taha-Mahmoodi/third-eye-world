import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FormData from 'form-data';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';
import { createTtsCache } from '../src/lib/tts-cache.js';
import { type SttClient } from '../src/lib/whisper.js';
import {
  signSession,
  verifySession,
  SESSION_COOKIE_NAME,
} from '../src/lib/session.js';

const SAMPLE_AUDIO = Buffer.from('fake-audio-name-recording');
const TEST_SECRET = 'test-session-secret-do-not-use-in-prod';

interface Ctx {
  app: FastifyInstance;
  tmpDir: string;
  transcribe: ReturnType<typeof vi.fn>;
}

async function makeCtx(opts: { withStt?: boolean } = {}): Promise<Ctx> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'tew-auth-'));
  const db = openDatabase({ filename: ':memory:' });
  const audioStore = await createAudioStore(join(tmpDir, 'audio'));
  const ttsCache = await createTtsCache(join(tmpDir, 'tts-cache'));
  const transcribe = vi.fn();
  const sttClient: SttClient = { transcribe };
  const app = await buildServer({
    db,
    audioStore,
    ttsCache,
    ttsClient: null,
    ttsAllowedVoices: new Set(),
    llmClient: null,
    sttClient: opts.withStt === false ? null : sttClient,
    sessionSecret: TEST_SECRET,
    rateLimitPerMinute: 1_000_000,
  });
  await app.ready();
  return { app, tmpDir, transcribe };
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

describe('signSession / verifySession', () => {
  it('round-trips a userId through the signed cookie value', () => {
    const signed = signSession('user-abc', TEST_SECRET);
    expect(verifySession(signed, TEST_SECRET)).toBe('user-abc');
  });

  it('rejects a forged signature', () => {
    const signed = signSession('user-abc', TEST_SECRET);
    const tampered = signed.slice(0, -2) + 'aa';
    expect(verifySession(tampered, TEST_SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const signed = signSession('user-abc', TEST_SECRET);
    expect(verifySession(signed, 'different-secret')).toBeNull();
  });

  it('rejects malformed values', () => {
    expect(verifySession('no-dot', TEST_SECRET)).toBeNull();
    expect(verifySession('.starts-with-dot', TEST_SECRET)).toBeNull();
    expect(verifySession('', TEST_SECRET)).toBeNull();
  });
});

describe('POST /api/auth/signup', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('creates a user with the Whisper-transcribed name and sets a session cookie', async () => {
    ctx = await makeCtx();
    ctx.transcribe.mockResolvedValueOnce('Asha.');

    const { body, headers } = buildMultipart('audio', 'name.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    const json = response.json<{ user: { id: string; name: string } }>();
    expect(json.user.name).toBe('Asha');
    expect(typeof json.user.id).toBe('string');

    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
  });

  it('falls back to "Listener" when no STT client is configured', async () => {
    ctx = await makeCtx({ withStt: false });

    const { body, headers } = buildMultipart('audio', 'name.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ user: { name: string } }>().user.name).toBe('Listener');
  });

  it('falls back to "Listener" when Whisper errors', async () => {
    ctx = await makeCtx();
    ctx.transcribe.mockRejectedValueOnce(new Error('boom'));

    const { body, headers } = buildMultipart('audio', 'name.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ user: { name: string } }>().user.name).toBe('Listener');
  });

  it('caps the name length at 80 chars', async () => {
    ctx = await makeCtx();
    ctx.transcribe.mockResolvedValueOnce('a'.repeat(150));

    const { body, headers } = buildMultipart('audio', 'name.webm', 'audio/webm', SAMPLE_AUDIO);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });

    const name = response.json<{ user: { name: string } }>().user.name;
    expect(name.length).toBe(80);
  });

  it('rejects an unsupported mime type', async () => {
    ctx = await makeCtx();
    const { body, headers } = buildMultipart('audio', 'name.txt', 'text/plain', Buffer.from('Asha'));
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });
    expect(response.statusCode).toBe(415);
  });
});

describe('GET /api/auth/me', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await makeCtx();
  });

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('returns 401 with no_session when no cookie is sent', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe('no_session');
  });

  it('returns the user when a valid cookie is sent', async () => {
    ctx.transcribe.mockResolvedValueOnce('Asha');
    const { body, headers } = buildMultipart('audio', 'a.webm', 'audio/webm', SAMPLE_AUDIO);
    const signup = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: body,
      headers,
    });
    const setCookie = signup.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof cookieHeader !== 'string') throw new Error('no cookie');
    const cookieValue = cookieHeader.split(';')[0];
    if (!cookieValue) throw new Error('empty cookie value');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieValue },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { name: string } }>().user.name).toBe('Asha');
  });

  it('returns 401 for a tampered cookie', async () => {
    const tampered = `${SESSION_COOKIE_NAME}=user-abc.invalid-signature`;
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: tampered },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for a cookie pointing at a deleted user', async () => {
    const fakeSigned = signSession('does-not-exist', TEST_SECRET);
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${fakeSigned}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await makeCtx();
  });

  afterEach(async () => {
    await ctx.app.close();
    await rm(ctx.tmpDir, { recursive: true, force: true });
  });

  it('clears the session cookie', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof cookieHeader !== 'string') throw new Error('no cookie');
    expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
    // clearCookie sets an expired Max-Age and/or Expires.
    expect(cookieHeader).toMatch(/Max-Age=0|Expires=/);
  });
});
