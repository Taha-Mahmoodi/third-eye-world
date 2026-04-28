import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { openDatabase, type DB } from './db/client.js';
import { ensureDemoUser } from './lib/demo-user.js';
import {
  createAudioStore,
  DEFAULT_UPLOAD_DIR,
  type AudioStore,
} from './lib/audio-store.js';
import { memosRoutes, MAX_AUDIO_BYTES } from './routes/memos.js';

export interface BuildOptions {
  db?: DB;
  audioStore?: AudioStore;
  /** Rate limit max per minute. Defaults to 60 per session in prod-like
   *  setups; tests can pass a high number to disable. */
  rateLimitPerMinute?: number;
}

export async function buildServer(options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  const db =
    options.db ??
    openDatabase({ filename: process.env.DB_FILE ?? './data/third-eye.db' });
  ensureDemoUser(db);

  const audioStore =
    options.audioStore ??
    (await createAudioStore(process.env.AUDIO_UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR));

  await app.register(multipart, {
    limits: {
      fileSize: MAX_AUDIO_BYTES,
      files: 1,
    },
  });

  await app.register(rateLimit, {
    max: options.rateLimitPerMinute ?? 60,
    timeWindow: '1 minute',
  });

  app.get('/health', () => {
    return { status: 'ok' };
  });

  await app.register(memosRoutes({ db, audioStore }));

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  buildServer()
    .then((app) =>
      app.listen({ port, host: '0.0.0.0' }).then((address) => {
        app.log.info(`Server listening at ${address}`);
      }),
    )
    .catch((err) => {
      // Last-resort error path before logger is set up.
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
