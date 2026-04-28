// LLM client — Phase 5 task 3.
//
// Thin wrapper around the OpenAI-compatible chat-completions endpoint
// served by Ollama (dev) or vLLM (prod). The API key is held server-side;
// the browser never sees it.
//
// Test seam: fetchImpl can be injected so tests don't hit a real LLM.

import { LLM_TOOL_DEFINITIONS, parseUpstreamToolCalls, type LlmResponse } from './tools.js';

export class LlmUpstreamError extends Error {
  override name = 'LlmUpstreamError';
  constructor(
    message: string,
    public readonly upstreamStatus: number,
  ) {
    super(message);
  }
}

export class LlmTimeoutError extends Error {
  override name = 'LlmTimeoutError';
}

export interface LlmClient {
  /** Send the system prompt + user transcript and return a parsed
   *  + validated response. Throws LlmUpstreamError or LlmTimeoutError
   *  on failure — the caller (route) translates to 502 / 504 + falls
   *  through to the deterministic parser. */
  complete(args: {
    systemPrompt: string;
    transcript: string;
  }): Promise<LlmResponse>;
}

export interface CreateLlmClientOptions {
  baseUrl: string;
  model: string;
  /** OpenAI-compat APIs require some auth header even for local Ollama
   *  (which accepts any value). */
  apiKey: string;
  /** Timeout in ms — § 9 Phase 5 task 7 says 2s before falling back. */
  timeoutMs?: number;
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_LLM_TIMEOUT_MS = 2_000;

interface UpstreamMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
}

interface UpstreamChoice {
  message: UpstreamMessage;
  finish_reason?: string;
}

interface UpstreamResponse {
  choices: UpstreamChoice[];
}

export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return {
    async complete(args) {
      const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const body = JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: args.transcript },
        ],
        tools: LLM_TOOL_DEFINITIONS,
        tool_choice: 'auto',
        // Encourage brevity — the spoken phrase is short, the tool calls
        // themselves are tiny.
        max_tokens: 256,
        temperature: 0.3,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new LlmTimeoutError(`LLM request exceeded ${timeoutMs}ms`);
        }
        throw new LlmUpstreamError(
          err instanceof Error ? err.message : 'network error',
          0,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // Drain the body without logging it — could include account info.
        await response.text().catch(() => undefined);
        throw new LlmUpstreamError(
          `LLM returned ${response.status}`,
          response.status,
        );
      }

      let upstream: UpstreamResponse;
      try {
        upstream = (await response.json()) as UpstreamResponse;
      } catch (err) {
        throw new LlmUpstreamError(
          err instanceof Error ? err.message : 'invalid JSON',
          response.status,
        );
      }

      const message = upstream.choices[0]?.message;
      if (!message) {
        throw new LlmUpstreamError('LLM returned no choices', response.status);
      }

      const rawCalls = (message.tool_calls ?? [])
        .filter((c) => c.type === 'function' && c.function?.name)
        .map((c) => ({
          name: c.function?.name ?? '',
          arguments: c.function?.arguments ?? '{}',
        }));

      if (rawCalls.length === 0) {
        // Per the system prompt, the model MUST emit a `speak` tool call.
        // A non-tool reply is a contract violation — surface as upstream
        // error so the route can fall back to the deterministic parser.
        throw new LlmUpstreamError(
          'LLM did not return any tool calls',
          response.status,
        );
      }

      return parseUpstreamToolCalls(rawCalls);
    },
  };
}
