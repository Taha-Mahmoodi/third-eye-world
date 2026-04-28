import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { openDatabase } from '../src/db/client.js';
import { createAudioStore } from '../src/lib/audio-store.js';

describe('GET /health', () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tew-health-'));
    const db = openDatabase({ filename: ':memory:' });
    const audioStore = await createAudioStore(join(tmpDir, 'audio'));
    app = await buildServer({ db, audioStore, rateLimitPerMinute: 1_000_000 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 200 with { status: "ok" }', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
