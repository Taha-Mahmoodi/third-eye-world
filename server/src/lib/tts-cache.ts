// TTS cache — sharded SHA-256 keyed disk cache for ElevenLabs MP3 bytes.
//
// Phase 3 task 2 per INSTRUCTIONS.md § 9 + the elevenlabs-integration skill.
//
// Cache key: sha256(text | voiceId | modelId | settingsJson)
// Path:      <rootDir>/<first-2-of-key>/<key>.mp3
//
// First-2-of-key sharding keeps the cache directory from holding hundreds of
// files at one level. Settings JSON includes stability, similarity_boost,
// style, use_speaker_boost so changing voice config invalidates the cache
// without us having to wipe the directory.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { dirname, join, resolve, sep } from 'node:path';

export interface TtsSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
};

const TTS_KEYS_IN_ORDER: ReadonlyArray<keyof TtsSettings> = [
  'similarity_boost',
  'stability',
  'style',
  'use_speaker_boost',
];

/** Canonical JSON for the settings object — keys sorted so the same logical
 *  settings always produce the same hash. */
export function canonicalSettingsJson(settings: TtsSettings): string {
  const sorted: Record<string, number | boolean> = {};
  for (const key of TTS_KEYS_IN_ORDER) {
    sorted[key] = settings[key];
  }
  return JSON.stringify(sorted);
}

export function ttsCacheKey(
  text: string,
  voiceId: string,
  modelId: string,
  settings: TtsSettings,
): string {
  return createHash('sha256')
    .update(`${text}|${voiceId}|${modelId}|${canonicalSettingsJson(settings)}`)
    .digest('hex');
}

export interface TtsCache {
  readonly rootDir: string;
  /** Absolute path the bytes for `key` live (or would live) at. */
  pathFor(key: string): string;
  has(key: string): Promise<boolean>;
  /** Open a read stream for the cached bytes. Throws if `has(key)` is false. */
  readStream(key: string): Readable;
  /** Save `bytes` under `key`. Atomic: writes to a temp file then renames. */
  save(key: string, bytes: Buffer): Promise<void>;
}

export async function createTtsCache(rootDir: string): Promise<TtsCache> {
  const absRoot = resolve(rootDir);
  await mkdir(absRoot, { recursive: true });

  function pathFor(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      throw new Error('tts-cache: invalid key');
    }
    const shard = key.slice(0, 2);
    const abs = join(absRoot, shard, `${key}.mp3`);
    if (!abs.startsWith(absRoot + sep)) {
      throw new Error('tts-cache: path traversal blocked');
    }
    return abs;
  }

  return {
    rootDir: absRoot,
    pathFor,

    async has(key) {
      try {
        await stat(pathFor(key));
        return true;
      } catch {
        return false;
      }
    },

    readStream(key) {
      return createReadStream(pathFor(key));
    },

    async save(key, bytes) {
      const abs = pathFor(key);
      await mkdir(dirname(abs), { recursive: true });
      // Write to a temp file in the same directory, then rename atomically
      // so a partial write never appears as a valid cache entry.
      const tmp = `${abs}.tmp.${process.pid}.${Date.now()}`;
      await writeFile(tmp, bytes);
      await rename(tmp, abs);
    },
  };
}
