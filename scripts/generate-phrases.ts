// Pre-generates ElevenLabs MP3s for every entry in client/src/strings.ts.
//
// Phase 3 task 3 per INSTRUCTIONS.md § 9 + the elevenlabs-integration skill.
//
// Run with:
//   ELEVENLABS_API_KEY=sk_...
//   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
//   npm run generate:phrases [-- --force] [-- --key RECORDING_POSTED]
//
// The MP3s land in client/public/audio/phrases/<KEY>.mp3 and are committed
// to the repo. The client tries them as link 1 of the fallback chain.
//
// Idempotent — already-generated keys are skipped unless --force is passed.
//
// Hard rules honored:
// - § 2 #9: API key never leaves this script's process (never written to a
//   file, never logged).
// - § 11: 200-char cap on text. The script aborts if any phrase is over.

import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../client/src/strings.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'client/public/audio/phrases');
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
const MODEL_ID = 'eleven_multilingual_v2'; // best quality for pre-baked
const TEXT_MAX_LEN = 200;
const TTS_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
};

interface CliOptions {
  force: boolean;
  onlyKey: string | null;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  const opts: CliOptions = { force: false, onlyKey: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--key') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--key requires an argument');
      }
      opts.onlyKey = next;
      i += 1;
    } else if (arg && arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return opts;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function synthesize(
  apiKey: string,
  voiceId: string,
  text: string,
): Promise<Buffer> {
  const url = `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: TTS_SETTINGS,
    }),
  });

  if (!response.ok) {
    // Read the error body but DO NOT log it — it can include account info.
    await response.arrayBuffer().catch(() => undefined);
    throw new Error(`ElevenLabs returned ${response.status}`);
  }

  const buf = await response.arrayBuffer();
  return Buffer.from(buf);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write('ELEVENLABS_API_KEY is required.\n');
    process.exit(1);
  }
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!voiceId) {
    process.stderr.write('ELEVENLABS_VOICE_ID is required.\n');
    process.exit(1);
  }

  // Validate every phrase before doing any network work — it's cheaper to
  // bail now than mid-generation.
  for (const [key, text] of Object.entries(STRINGS)) {
    if (text.length === 0) {
      throw new Error(`STRINGS.${key} is empty`);
    }
    if (text.length > TEXT_MAX_LEN) {
      throw new Error(
        `STRINGS.${key} is ${text.length} chars; max ${TEXT_MAX_LEN} (§ 11).`,
      );
    }
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [key, text] of Object.entries(STRINGS)) {
    if (opts.onlyKey && key !== opts.onlyKey) continue;

    const outPath = resolve(OUTPUT_DIR, `${key}.mp3`);

    if (!opts.force && (await fileExists(outPath))) {
      process.stdout.write(`skip   ${key}\n`);
      skipped += 1;
      continue;
    }

    try {
      const bytes = await synthesize(apiKey, voiceId, text);
      await writeFile(outPath, bytes);
      process.stdout.write(`gen    ${key}  (${bytes.length} bytes)\n`);
      generated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`FAIL   ${key}: ${message}\n`);
      failed += 1;
    }
  }

  process.stdout.write(
    `\nGenerated: ${generated}  Skipped: ${skipped}  Failed: ${failed}\n`,
  );

  if (failed > 0) process.exit(1);
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`generate-phrases: ${message}\n`);
  process.exit(1);
});
