# LLM tool-call schema

Phase 5 task 1 per [INSTRUCTIONS.md § 9](../INSTRUCTIONS.md#9). The LLM (Qwen 2.5 32B) is called from `server/src/routes/llm.ts` with a strict set of tools. The tools mirror the `CommandAction` enum in `client/src/commands/registry.ts` exactly — adding a new action requires a row in [.claude/skills/voice-grammar/SKILL.md](../.claude/skills/voice-grammar/SKILL.md), an entry in `CommandAction`, and a tool here.

The model **always** emits at least one `speak` tool call so the user gets feedback (§ 2 #3, § 12). Other tool calls are optional — a "speak only" response is valid (e.g. for help).

## Tool list

| Tool name        | Arguments                          | Effect                                                                                  | Maps to `CommandAction` |
|------------------|------------------------------------|------------------------------------------------------------------------------------------|--------------------------|
| `record_memo`    | `{}`                               | Start a top-level memo recording.                                                        | `RECORD_START`           |
| `post_recording` | `{}`                               | Stop the in-flight recording and post it (memo or comment).                              | `RECORD_STOP_POST`       |
| `next_memo`      | `{}`                               | Skip to the next memo in the feed.                                                       | `NEXT_MEMO`              |
| `previous_memo`  | `{}`                               | Go back one memo.                                                                        | `PREVIOUS_MEMO`          |
| `pause`          | `{}`                               | Pause playback.                                                                          | `PAUSE`                  |
| `resume`         | `{}`                               | Resume playback.                                                                         | `RESUME`                 |
| `like_memo`      | `{ memo_id: string }`              | Like the memo with the given id. (Server validates existence.)                           | `LIKE`                   |
| `unlike_memo`    | `{ memo_id: string }`              | Unlike the memo with the given id.                                                       | `UNLIKE`                 |
| `start_comment`  | `{ memo_id: string }`              | Begin recording a reply to the memo with the given id.                                   | `COMMENT`                |
| `cancel`         | `{}`                               | Universal kill switch — cancels recording, playback, comment-pending. Always available.  | `STOP`                   |
| `speak_help`     | `{}`                               | Speak the v1 command list (HELP_LIST).                                                   | `HELP`                   |
| `speak`          | `{ phrase: string }`               | **Always required.** A 1–2 short-sentence reply, ≤200 chars, no markdown/emoji/parens.   | (no equivalent — speech) |

## TypeScript shape

The schema is mirrored in `server/src/llm/tools.ts` so the dispatcher and the OpenAI-compatible tool-call API both stay in sync:

```typescript
export type LlmToolCall =
  | { name: 'record_memo';    arguments: Record<string, never> }
  | { name: 'post_recording'; arguments: Record<string, never> }
  | { name: 'next_memo';      arguments: Record<string, never> }
  | { name: 'previous_memo';  arguments: Record<string, never> }
  | { name: 'pause';          arguments: Record<string, never> }
  | { name: 'resume';         arguments: Record<string, never> }
  | { name: 'like_memo';      arguments: { memo_id: string } }
  | { name: 'unlike_memo';    arguments: { memo_id: string } }
  | { name: 'start_comment';  arguments: { memo_id: string } }
  | { name: 'cancel';         arguments: Record<string, never> }
  | { name: 'speak_help';     arguments: Record<string, never> }
  | { name: 'speak';          arguments: { phrase: string } };

export interface LlmResponse {
  /** One or more tool calls. The dispatcher executes them in order. */
  tool_calls: LlmToolCall[];
}
```

## System prompt rules (enforced at the prompt and at the dispatcher)

The full system prompt lives in `server/src/llm/system-prompt.ts`. Summary:

1. **Always emit a `speak` tool call.** A response with only side-effect tools (e.g. `like_memo` alone) is rejected by the proxy and re-prompted. The user must hear something happen (§ 2 #3).
2. **Spoken phrases are 1–2 short sentences, ≤200 characters.** No lists, no markdown, no parentheses, no emojis (§ 12 + the `third-eye-tone` skill).
3. **Confirm what just happened, then optionally one next step.** Not both required, but the confirmation is.
4. **Never invent a result.** If a tool dispatcher returned an error, the host says so honestly and briefly (e.g. "I couldn't find that memo. Try saying next.").
5. **Tone matches the `third-eye-tone` skill.** Calm, warm, present-tense. No "As an AI…", no double-apologies, no explaining the interface ("click the button" — there is no button).

## Dispatcher contract (server-side)

`server/src/llm/dispatcher.ts` (Phase 5 task 4) accepts an `LlmResponse` plus a session context (current memo id, user id) and:

1. Validates every tool call against the schema (`zod`).
2. For arg-bearing tools, validates that referenced ids belong to the user's reachable set (the LLM's word is not trust — § 7.3 security audit).
3. Executes the tool calls in order. If any fails, the dispatcher stops and surfaces the error so the model's `speak` text can be replaced with a polite failure message before sending it to the client.
4. Returns the resolved spoken text + a record of executed tools to the client. The client plays the spoken text via the same `speak()` chain used by the deterministic command path.

## Deterministic fallback (Phase 5 task 7)

If `/api/llm` fails or times out (>2s), the client falls back to the Phase 2 deterministic parser (`client/src/commands/parser.ts`). The user gets degraded but still-functional command handling — § 18: "The app gives a quieter 'I'm having trouble understanding right now — try the basics like next, like, or comment.'"

The fallback path:
1. Whisper transcript flows into `parseCommand(transcript)` (already implemented in Phase 2).
2. If that returns a `CommandAction`, dispatch as today.
3. If that returns `null`, speak `STRINGS.UNKNOWN_COMMAND` (already implemented).

The fallback never blocks on the LLM, so the app remains responsive even when the GPU box is offline.
