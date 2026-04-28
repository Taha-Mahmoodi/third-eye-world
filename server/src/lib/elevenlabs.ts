// ElevenLabs API client — server-side only.
//
// Phase 3 task 2 per INSTRUCTIONS.md § 9. The API key never crosses the
// network/server boundary in either direction (§ 2 #9): callers pass a
// pre-loaded key value, and this module is the only place that talks to
// api.elevenlabs.io.
//
// We model the call as a function-injection seam — TtsClient receives a
// fetch-like function so tests can inject a mock without touching globals.

import type { TtsSettings } from './tts-cache.js';

export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export type TtsModelId = 'eleven_multilingual_v2' | 'eleven_turbo_v2_5';

export const DEFAULT_TTS_MODEL: TtsModelId = 'eleven_multilingual_v2';
export const STREAM_TTS_MODEL: TtsModelId = 'eleven_turbo_v2_5';

export interface SynthesizeRequest {
  text: string;
  voiceId: string;
  modelId: TtsModelId;
  settings: TtsSettings;
}

export interface TtsClient {
  /** Returns the audio bytes (audio/mpeg). Caller decides whether to
   *  stream them to the HTTP response or write to disk first. */
  synthesize(req: SynthesizeRequest): Promise<Buffer>;
}

export class TtsUpstreamError extends Error {
  override name = 'TtsUpstreamError';
  constructor(
    message: string,
    public readonly upstreamStatus: number,
  ) {
    super(message);
  }
}

export interface CreateTtsClientOptions {
  apiKey: string;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override the base URL — used by the voice-selection test page when
   *  pointing at a staging environment. */
  baseUrl?: string;
}

export function createTtsClient(options: CreateTtsClientOptions): TtsClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? ELEVENLABS_BASE_URL;

  return {
    async synthesize(req) {
      const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/stream`;
      const body = JSON.stringify({
        text: req.text,
        model_id: req.modelId,
        voice_settings: req.settings,
      });

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'xi-api-key': options.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body,
        });
      } catch (err) {
        throw new TtsUpstreamError(
          err instanceof Error ? err.message : 'network error',
          0,
        );
      }

      if (!response.ok) {
        // Surface the upstream status. The route translates this into 502.
        // We do not include the response body in the error — it could
        // contain account info we should not log.
        throw new TtsUpstreamError(
          `ElevenLabs returned ${response.status}`,
          response.status,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
  };
}
