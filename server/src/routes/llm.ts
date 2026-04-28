// POST /api/llm — Phase 5 task 3.
//
// Receives { transcript, context } from the client (after Whisper STT
// in the next PR), calls the upstream LLM via createLlmClient, and
// returns the parsed tool calls.
//
// Failure modes (per docs/llm-tools.md):
// - No client configured           → 503 llm_disabled  (client falls
//                                                       to deterministic parser)
// - Timeout > 2s                   → 504 llm_timeout    (same fallback)
// - Upstream error / contract fail → 502 llm_upstream   (same fallback)
//
// Hard rules honored:
// - § 13: zod-validated input + output.
// - § 7.3: prompt-injection mitigation — the transcript is NOT
//   interpolated into the system prompt; it goes in as a separate
//   user message. Memo ids in the response are validated against the
//   DB by the dispatcher (next PR).

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  type LlmClient,
  LlmTimeoutError,
  LlmUpstreamError,
} from '../llm/client.js';
import { buildSystemPrompt } from '../llm/system-prompt.js';
import { DispatchError, dispatchLlmResponse } from '../llm/dispatcher.js';
import type { DB } from '../db/client.js';

const TRANSCRIPT_MAX_LEN = 1_000;

const llmRequestSchema = z.object({
  transcript: z.string().min(1).max(TRANSCRIPT_MAX_LEN),
  context: z
    .object({
      current_memo: z
        .object({
          id: z.string().min(1),
          user_name: z.string().min(1).max(80),
        })
        .optional(),
      user_name: z.string().min(1).max(80).optional(),
    })
    .default({}),
});

export interface LlmRoutesOptions {
  /** null when LLM_BASE_URL is unset — proxy returns 503 in that case
   *  so the client falls to the deterministic parser. */
  client: LlmClient | null;
  /** DB used by the dispatcher to validate memo_ids and execute
   *  server-side tools (like_memo, unlike_memo). */
  db: DB;
}

export const llmRoutes = (options: LlmRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function llmRoutesPlugin(app: FastifyInstance) {
    app.post('/api/llm', async (request, reply) => {
      const parsed = llmRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.errors[0]?.message ?? 'invalid body',
        });
      }
      const { transcript, context } = parsed.data;

      if (!options.client) {
        return reply.code(503).send({
          error: 'llm_disabled',
          message: 'LLM is not configured on the server',
        });
      }

      const systemPrompt = buildSystemPrompt(context);

      try {
        const result = await options.client.complete({
          systemPrompt,
          transcript,
        });
        // Server-side dispatch validates memo_ids and runs DB-only tools.
        try {
          const dispatched = dispatchLlmResponse(result, { db: options.db });
          return reply.send(dispatched);
        } catch (dispatchErr) {
          if (dispatchErr instanceof DispatchError) {
            request.log.warn(
              { code: dispatchErr.code, msg: dispatchErr.message },
              'llm dispatch error',
            );
            // Surface as 502 so the client falls back to the deterministic
            // parser — same path as upstream errors.
            return reply.code(502).send({
              error: 'llm_dispatch_failed',
              message: dispatchErr.message,
              code: dispatchErr.code,
            });
          }
          throw dispatchErr;
        }
      } catch (err) {
        if (err instanceof LlmTimeoutError) {
          request.log.warn({ err: err.message }, 'llm timeout');
          return reply.code(504).send({
            error: 'llm_timeout',
            message: 'LLM did not respond in time',
          });
        }
        if (err instanceof LlmUpstreamError) {
          request.log.warn(
            { upstream_status: err.upstreamStatus, err: err.message },
            'llm upstream error',
          );
          return reply.code(502).send({
            error: 'llm_upstream',
            message: 'LLM returned an error',
          });
        }
        request.log.error({ err }, 'llm unexpected failure');
        return reply.code(502).send({
          error: 'llm_upstream',
          message: 'LLM request failed',
        });
      }
    });
  };
