// Whisper client — OpenAI hosted speech-to-text.
//
// Phase 5 task 5 per INSTRUCTIONS.md § 9 + § 3 stack pick.
//
// API key (OPENAI_API_KEY) lives server-side only — the browser never
// sees it (§ 2 #9). fetchImpl is a test seam.

export const OPENAI_BASE_URL = 'https://api.openai.com';
export const DEFAULT_WHISPER_MODEL = 'whisper-1';

export class SttUpstreamError extends Error {
  override name = 'SttUpstreamError';
  constructor(
    message: string,
    public readonly upstreamStatus: number,
  ) {
    super(message);
  }
}

export interface SttClient {
  /** Transcribes the audio bytes. mimeType drives the form's filename
   *  extension so OpenAI accepts it. */
  transcribe(args: { audio: Buffer; mimeType: string }): Promise<string>;
}

export interface CreateSttClientOptions {
  apiKey: string;
  /** Defaults to 'whisper-1'. */
  model?: string;
  /** Defaults to OPENAI_BASE_URL. */
  baseUrl?: string;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

export function createSttClient(options: CreateSttClientOptions): SttClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? OPENAI_BASE_URL;
  const model = options.model ?? DEFAULT_WHISPER_MODEL;

  return {
    async transcribe({ audio, mimeType }) {
      const ext = MIME_TO_EXTENSION[mimeType] ?? 'webm';
      const filename = `audio.${ext}`;

      // Browser-style FormData works in Node 20+ and lets fetch set the
      // boundary header automatically — same path the actual frontend
      // uses for /api/memos.
      const form = new FormData();
      const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
      form.append('file', blob, filename);
      form.append('model', model);
      form.append('response_format', 'json');
      form.append('language', 'en');

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: form,
        });
      } catch (err) {
        throw new SttUpstreamError(
          err instanceof Error ? err.message : 'network error',
          0,
        );
      }

      if (!response.ok) {
        // Drain the body but never log it — could include account info.
        await response.text().catch(() => undefined);
        throw new SttUpstreamError(
          `Whisper returned ${response.status}`,
          response.status,
        );
      }

      const data = (await response.json().catch(() => null)) as {
        text?: string;
      } | null;
      if (!data || typeof data.text !== 'string') {
        throw new SttUpstreamError(
          'Whisper response missing text field',
          response.status,
        );
      }
      return data.text.trim();
    },
  };
}
