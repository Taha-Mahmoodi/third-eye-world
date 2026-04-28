// Audio store — writes audio bytes to disk under AUDIO_UPLOAD_DIR.
//
// Demo target is the local filesystem (INSTRUCTIONS.md § 3). Production target
// is S3, swapped behind this same module's API. Phase 1 only needs the local
// path.
//
// Hard rules from § 13 enforced here:
// - Filenames are server-generated (UUIDs), never user-supplied. No path
//   traversal possible.
// - Audio store path is sandboxed to AUDIO_UPLOAD_DIR. The save() function
//   never writes outside it.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_UPLOAD_DIR = './uploads/audio';

export const ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const MIME_TO_EXTENSION: Record<AllowedMimeType, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export interface AudioStore {
  /** Where audio is being written. Resolved absolute path. */
  readonly rootDir: string;
  /**
   * Persist `bytes` and return the relative path stored on disk
   * (relative to rootDir). Server-generated filename.
   */
  save(bytes: Buffer, mimeType: AllowedMimeType): Promise<string>;
  /** Resolve a stored relative path to an absolute filesystem path. */
  resolveAbsolute(relativePath: string): string;
}

export async function createAudioStore(uploadDir: string = DEFAULT_UPLOAD_DIR): Promise<AudioStore> {
  const rootDir = resolve(uploadDir);
  await mkdir(rootDir, { recursive: true });

  return {
    rootDir,

    async save(bytes, mimeType) {
      const ext = MIME_TO_EXTENSION[mimeType];
      const filename = `${randomUUID()}.${ext}`;
      const abs = join(rootDir, filename);

      // Guardrail: even though `filename` is a UUID we generated, refuse to
      // write anywhere outside rootDir. Cheap, catches mistakes if this
      // module ever takes a caller-supplied filename in the future.
      if (!abs.startsWith(rootDir + sep)) {
        throw new Error('audio-store: refusing to write outside rootDir');
      }

      await writeFile(abs, bytes);
      return filename;
    },

    resolveAbsolute(relativePath) {
      const abs = resolve(rootDir, relativePath);
      if (!abs.startsWith(rootDir + sep)) {
        throw new Error('audio-store: path traversal blocked');
      }
      return abs;
    },
  };
}
