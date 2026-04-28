// LLM pipeline — Phase 5 task 6 per INSTRUCTIONS.md § 9.
//
// Sends a Web Speech transcript to /api/llm and translates the response's
// `client_actions` into CommandActions that the existing dispatcher can
// execute. Server-side tools (like_memo, unlike_memo) are already done by
// the server-side dispatcher (PR #40) — we just speak the spoken phrase.
//
// Failure modes (per Phase 5 task 7 — deterministic fallback):
// - 503 llm_disabled         → return null, caller falls to parseCommand()
// - 504 llm_timeout          → same
// - 502 llm_upstream         → same
// - 502 llm_dispatch_failed  → same
// - Network error            → same
//
// Hard rules:
// - § 18 quieter degraded mode: caller speaks STRINGS.UNKNOWN_COMMAND when
//   even the deterministic parser fails. The pipeline itself never throws —
//   any failure returns null.

import { CommandAction } from '../commands/registry.js';

export interface LlmPipelineContext {
  current_memo?: { id: string; user_name: string };
  user_name?: string;
}

export interface LlmPipelineResult {
  /** The spoken phrase the model produced. The caller passes this to
   *  speak() with textOverride. */
  speak_text: string;
  /** CommandActions the client should dispatch. Order preserved from
   *  the LLM response. */
  actions: CommandAction[];
  /** Tool names the server already executed. For logging / future UI. */
  executed: string[];
}

/**
 * Outcome of one /api/llm round-trip. The caller distinguishes:
 * - 'ok'       → use the speak_text + dispatch the actions
 * - 'disabled' → server returned 503 llm_disabled (LLM not configured —
 *                expected in local-only mode, fall to deterministic parser
 *                without firing DEGRADED_MODE)
 * - 'errored'  → 502 / 504 / network / shape error. Caller falls to
 *                deterministic parser; if that also fails, speak
 *                STRINGS.DEGRADED_MODE because the LLM was tried but
 *                broke (§ 18 contextual fallback).
 */
export type LlmPipelineOutcome =
  | { status: 'ok'; result: LlmPipelineResult }
  | { status: 'disabled' }
  | { status: 'errored' };

interface LlmRouteResponse {
  speak_text: string;
  client_actions: Array<{ name: string }>;
  executed: Array<{ name: string }>;
}

const TOOL_TO_ACTION: Record<string, CommandAction | null> = {
  record_memo: CommandAction.RECORD_START,
  post_recording: CommandAction.RECORD_STOP_POST,
  next_memo: CommandAction.NEXT_MEMO,
  previous_memo: CommandAction.PREVIOUS_MEMO,
  pause: CommandAction.PAUSE,
  resume: CommandAction.RESUME,
  start_comment: CommandAction.COMMENT,
  cancel: CommandAction.STOP,
  speak_help: CommandAction.HELP,
  // like_memo, unlike_memo are server-only — they show up in executed,
  // never in client_actions, so they should never reach this map.
};

export interface LlmPipelineOptions {
  /** Test seam — defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Send the transcript to /api/llm. Returns:
 * - { status: 'ok', result }   on success
 * - { status: 'disabled' }     when the server returns 503 llm_disabled
 * - { status: 'errored' }      on any other failure
 */
export async function routeViaLlm(
  transcript: string,
  context: LlmPipelineContext,
  options: LlmPipelineOptions = {},
): Promise<LlmPipelineOutcome> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return { status: 'errored' };

  let response: Response;
  try {
    response = await fetchImpl('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, context }),
    });
  } catch {
    return { status: 'errored' };
  }

  if (response.status === 503) {
    // llm_disabled — server has no LLM configured. This is the steady
    // state in local-only mode; no degraded message at the caller.
    return { status: 'disabled' };
  }
  if (!response.ok) {
    return { status: 'errored' };
  }

  let data: LlmRouteResponse;
  try {
    data = (await response.json()) as LlmRouteResponse;
  } catch {
    return { status: 'errored' };
  }

  if (typeof data.speak_text !== 'string' || !Array.isArray(data.client_actions)) {
    return { status: 'errored' };
  }

  const actions: CommandAction[] = [];
  for (const call of data.client_actions) {
    const action = TOOL_TO_ACTION[call.name];
    if (action !== null && action !== undefined) {
      actions.push(action);
    }
    // Unknown tool names are silently dropped — the server-side schema
    // already validated, so any unknown name here is a future-extension
    // we don't yet support on the client.
  }

  const executed = (data.executed ?? []).map((c) => c.name);

  return {
    status: 'ok',
    result: { speak_text: data.speak_text, actions, executed },
  };
}
