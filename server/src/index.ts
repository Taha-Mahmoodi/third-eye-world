import { pathToFileURL } from 'node:url';
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
import { createTtsCache, type TtsCache } from './lib/tts-cache.js';
import { createTtsClient, type TtsClient } from './lib/elevenlabs.js';
import { memosRoutes, MAX_AUDIO_BYTES } from './routes/memos.js';
import { likesRoutes } from './routes/likes.js';
import { commentsRoutes } from './routes/comments.js';
import { ttsRoutes } from './routes/tts.js';
import { llmRoutes } from './routes/llm.js';
import { createLlmClient, type LlmClient } from './llm/client.js';
import { sttRoutes } from './routes/stt.js';
import { createSttClient, type SttClient } from './lib/whisper.js';

const DEFAULT_TTS_CACHE_DIR = './cache/tts';

export interface BuildOptions {
  db?: DB;
  audioStore?: AudioStore;
  ttsCache?: TtsCache;
  /** Pass null to force the proxy to return 503 (test seam + the
   *  intended behavior when ELEVENLABS_API_KEY is unset). */
  ttsClient?: TtsClient | null;
  ttsAllowedVoices?: ReadonlySet<string>;
  /** Pass null to force /api/llm to return 503 (test seam + the
   *  intended behavior when LLM_BASE_URL is unset). */
  llmClient?: LlmClient | null;
  /** Pass null to force /api/stt to return 503 (test seam + the
   *  intended behavior when OPENAI_API_KEY is unset). */
  sttClient?: SttClient | null;
  /** Rate limit max per minute. Defaults to 60 per session in prod-like
   *  setups; tests can pass a high number to disable. */
  rateLimitPerMinute?: number;
}

function parseAllowedVoices(): ReadonlySet<string> {
  const list = process.env.ELEVENLABS_ALLOWED_VOICES?.trim();
  const defaultVoice = process.env.ELEVENLABS_VOICE_ID?.trim();
  const voices = new Set<string>();
  if (list) {
    for (const v of list.split(',')) {
      const trimmed = v.trim();
      if (trimmed) voices.add(trimmed);
    }
  }
  if (defaultVoice) voices.add(defaultVoice);
  return voices;
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

  const ttsCache =
    options.ttsCache ??
    (await createTtsCache(process.env.TTS_CACHE_DIR ?? DEFAULT_TTS_CACHE_DIR));

  // ttsClient: pass an explicit value (including null) via options to skip
  // env-based construction. Otherwise build from ELEVENLABS_API_KEY; when
  // it's missing, leave the client null so the proxy returns 503.
  const ttsClient =
    options.ttsClient !== undefined
      ? options.ttsClient
      : process.env.ELEVENLABS_API_KEY
        ? createTtsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
        : null;

  const ttsAllowedVoices = options.ttsAllowedVoices ?? parseAllowedVoices();

  const llmClient =
    options.llmClient !== undefined
      ? options.llmClient
      : process.env.LLM_BASE_URL
        ? createLlmClient({
            baseUrl: process.env.LLM_BASE_URL,
            model: process.env.LLM_MODEL ?? 'qwen2.5:32b-instruct',
            apiKey: process.env.LLM_API_KEY ?? 'ollama',
          })
        : null;

  const sttClient =
    options.sttClient !== undefined
      ? options.sttClient
      : process.env.OPENAI_API_KEY
        ? createSttClient({ apiKey: process.env.OPENAI_API_KEY })
        : null;

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
  await app.register(likesRoutes({ db }));
  await app.register(commentsRoutes({ db, audioStore }));
  await app.register(
    ttsRoutes({
      client: ttsClient,
      cache: ttsCache,
      allowedVoices: ttsAllowedVoices,
      defaultVoice: process.env.ELEVENLABS_VOICE_ID?.trim(),
    }),
  );
  await app.register(llmRoutes({ client: llmClient, db }));
  await app.register(sttRoutes({ client: sttClient }));

  return app;
}

// pathToFileURL handles Windows backslash → forward-slash conversion that a
// simple `file://${argv[1]}` does not. Without this, `npm run dev:server`
// silently exits on Windows because the equality check fails.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
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
