// LLM dispatcher — Phase 5 task 4 per INSTRUCTIONS.md § 9.
//
// Takes a parsed LlmResponse and:
// 1. Validates referenced memo_ids exist in the DB. The LLM's word is not
//    trust (§ 7.3 security audit) — it could hallucinate an id.
// 2. Executes server-side actions in place (like_memo, unlike_memo).
//    DB writes happen here; the client doesn't need to round-trip
//    /api/memos/:id/like for LLM-initiated likes.
// 3. Returns:
//    - speak_text: the spoken phrase the client plays
//    - client_actions: tool calls the client still needs to execute
//      (next_memo, pause, start_comment, etc. — anything that affects
//       browser-side state)
//    - executed: server-side tool calls already run, for logging/UI
//
// Hard rules:
// - § 2 #3: every response must include a speak. Throws if missing.
// - § 7.3: zod validation is the wall against malformed input, but
//   memo_id existence is a runtime check (DB-backed).

import type { DB } from '../db/client.js';
import { DEMO_USER_ID } from '../lib/demo-user.js';
import type { LlmResponse, LlmToolCall } from './tools.js';

export interface DispatchContext {
  db: DB;
  /** Phase-1 demo user; Phase 6 swaps for req.session.userId. */
  userId?: string;
}

export interface DispatchResult {
  /** Spoken phrase to feed the TTS pipeline. Always present after a
   *  successful dispatch — extracted from the required `speak` tool. */
  speak_text: string;
  /** Tool calls the client should execute. Server-side tools that have
   *  already been run are NOT included here. */
  client_actions: LlmToolCall[];
  /** Server-side tools that were executed during dispatch. */
  executed: LlmToolCall[];
}

export class DispatchError extends Error {
  override name = 'DispatchError';
  constructor(
    message: string,
    public readonly code:
      | 'no_speak'
      | 'memo_not_found'
      | 'db_error'
      | 'multiple_speak',
  ) {
    super(message);
  }
}

const SERVER_SIDE_TOOLS = new Set(['like_memo', 'unlike_memo']);

export function dispatchLlmResponse(
  response: LlmResponse,
  ctx: DispatchContext,
): DispatchResult {
  // Find the speak tool. There must be exactly one.
  const speakCalls = response.tool_calls.filter((c) => c.name === 'speak');
  if (speakCalls.length === 0) {
    throw new DispatchError('LLM response missing speak tool', 'no_speak');
  }
  if (speakCalls.length > 1) {
    throw new DispatchError(
      'LLM response had more than one speak tool',
      'multiple_speak',
    );
  }
  // After zod validation in tools.ts, speak.arguments has { phrase: string }.
  const speakCall = speakCalls[0];
  if (!speakCall || speakCall.name !== 'speak') {
    throw new DispatchError('LLM response missing speak tool', 'no_speak');
  }
  const speak_text = speakCall.arguments.phrase;

  // Validate memo_ids on every tool that has one — even tools we don't
  // execute server-side. The client should not be asked to act on a
  // memo that doesn't exist.
  const memoExists = ctx.db.prepare<[string], { id: string }>(
    'SELECT id FROM memos WHERE id = ?',
  );
  for (const call of response.tool_calls) {
    if (
      (call.name === 'like_memo' ||
        call.name === 'unlike_memo' ||
        call.name === 'start_comment') &&
      !memoExists.get(call.arguments.memo_id)
    ) {
      throw new DispatchError(
        `memo not found: ${call.arguments.memo_id}`,
        'memo_not_found',
      );
    }
  }

  const userId = ctx.userId ?? DEMO_USER_ID;
  const insertLike = ctx.db.prepare(
    `INSERT INTO likes (user_id, memo_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, memo_id) DO NOTHING`,
  );
  const deleteLike = ctx.db.prepare(
    `DELETE FROM likes WHERE user_id = ? AND memo_id = ?`,
  );

  const executed: LlmToolCall[] = [];
  const client_actions: LlmToolCall[] = [];

  for (const call of response.tool_calls) {
    if (call.name === 'speak') continue; // returned via speak_text

    if (call.name === 'like_memo') {
      try {
        insertLike.run(userId, call.arguments.memo_id, Date.now());
        executed.push(call);
      } catch (err) {
        throw new DispatchError(
          `db error on like_memo: ${err instanceof Error ? err.message : 'unknown'}`,
          'db_error',
        );
      }
      continue;
    }

    if (call.name === 'unlike_memo') {
      try {
        deleteLike.run(userId, call.arguments.memo_id);
        executed.push(call);
      } catch (err) {
        throw new DispatchError(
          `db error on unlike_memo: ${err instanceof Error ? err.message : 'unknown'}`,
          'db_error',
        );
      }
      continue;
    }

    // Anything else is a client-side action (next_memo, pause, start_comment,
    // record_memo, post_recording, cancel, speak_help).
    if (SERVER_SIDE_TOOLS.has(call.name)) {
      // Defensive — should never hit because of the explicit branches above.
      continue;
    }
    client_actions.push(call);
  }

  return { speak_text, client_actions, executed };
}
