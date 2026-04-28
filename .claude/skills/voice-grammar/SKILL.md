---
name: voice-grammar
description: The canonical list of utterances the Third Eye World app recognizes, their synonyms, and the action each maps to. Single source of truth used by client/src/commands/parser.ts, the LLM system prompt (Phase 5+), and the voice-ux-specialist subagent. Update whenever a command is added or changed.
---

# Voice grammar — v1 canonical command set

This skill is the source of truth for what users can say. It is referenced by:
- `client/src/commands/registry.ts` — the canonical `CommandAction` enum
- `client/src/commands/parser.ts` — the utterance → action mapping (this table compiled into code)
- `client/src/commands/keyboard.ts` — keyboard equivalents (every voice command has one — § 2 #6)
- `server/src/llm/system-prompt.ts` — the LLM tool list (Phase 5 onward)
- `.claude/agents/voice-ux-specialist.md` — keyboard-equivalent + tone audit

## Hard rules

These come from INSTRUCTIONS.md and are not negotiable:

1. **"Stop" must always work** (§ 2 #5). It is the kill switch — every state must accept it. Synonyms: `cancel`, `never mind`. Keyboard: `Escape`.
2. **Every voice command must have a keyboard equivalent** (§ 2 #6). New entries without a keyboard column are a fail at audit.
3. **Synonyms exist so users do not have to memorize.** Add them generously; remove only if they collide with another action.
4. **Spoken confirmations live in `client/src/strings.ts`** (§ 2 #10). The "Confirmation" column below names the `StringKey`, not the literal phrase.
5. **The LLM in Phase 5 may interpret freeform speech**, but it must still resolve to one of these actions plus a `speak` reply (§ 12). New actions added to this table also need to land in the LLM tool schema.

## v1 canonical commands

| Action               | Primary utterance | Synonyms                                     | Keyboard       | Confirmation key             | Notes |
|----------------------|-------------------|----------------------------------------------|----------------|------------------------------|-------|
| `RECORD_START`       | "record"          | "start", "post a memo", "new memo"           | `R`            | `RECORDING_STARTED`          | Phase 1 wires the record button click; voice triggers the same path. |
| `RECORD_STOP_POST`   | "post"            | "send", "share", "done"                      | `Enter`        | `RECORDING_POSTED`           | Stops recording and uploads. |
| `NEXT_MEMO`          | "next"            | "skip", "next memo"                          | `ArrowRight`   | `PLAYBACK_NEXT`              | |
| `PREVIOUS_MEMO`      | "previous"        | "back", "go back", "previous memo"           | `ArrowLeft`    | `PLAYBACK_PREVIOUS`          | |
| `PAUSE`              | "pause"           | "wait", "hold on"                            | `Space`        | `PLAYBACK_PAUSED`            | Space toggles pause/resume. |
| `RESUME`             | "resume"          | "play", "continue"                           | `Space`        | `PLAYBACK_RESUMED`           | Space toggles pause/resume. |
| `LIKE`               | "like"            | "heart", "love this", "love it"              | `L`            | `LIKED`                      | Phase 4 wires to `POST /api/memos/:id/like`. |
| `UNLIKE`             | "unlike"          | "remove like", "unlike this"                 | `Shift+L`      | `UNLIKED`                    | Phase 4. |
| `COMMENT`            | "comment"         | "reply", "respond"                           | `C`            | `COMMENT_RECORDING`          | Triggers a recording flow targeted at the current memo. Phase 4. |
| `STOP`               | "stop"            | "cancel", "never mind"                       | `Escape`       | `CANCELLED`                  | Hard kill switch (§ 2 #5). Cancels recording, playback, comment-flow — always. |
| `HELP`               | "help"            | "what can I say", "commands", "what now"     | `?`            | `HELP_LIST`                  | Speaks the command list. The phrase itself lives in `strings.ts`. |

## How synonyms are matched

The parser performs a case-insensitive match against the user's transcript:

1. **Exact match** on the primary utterance.
2. **Exact match** on any synonym.
3. **Whole-word containment** — useful for filler ("um, like!"). The parser strips leading filler ("uh", "um", "okay") and trailing punctuation, then tries (1) and (2) again.
4. If still no match, the parser returns `null` and the dispatcher speaks `STRINGS.UNKNOWN_COMMAND` so the user is never silently ignored (§ 2 #4).

## Adding a new command

1. Add a row to the table above.
2. Add the `CommandAction` enum value to `client/src/commands/registry.ts`.
3. Add the utterance + synonyms to the parser map.
4. Add the keyboard equivalent to `client/src/commands/keyboard.ts`.
5. Add the confirmation key to `client/src/strings.ts` (≤200 chars, no markdown / emoji / parens — § 12).
6. If the LLM is involved (Phase 5+), add the tool to `server/src/llm/tools.ts`.
7. Add a parser test for the primary utterance + every synonym. Add a keyboard test for the shortcut.

The `voice-ux-specialist` subagent will block any PR that adds a voice command without a keyboard equivalent or a confirmation phrase.

## What "feature parity" means at the Phase 2 audit

Per § 9 Phase 2 audit: "Voice + keyboard reach feature parity." Concretely:

- Every row above has a working voice path *and* a working keyboard path.
- Every row's `Confirmation key` exists in `strings.ts` and is spoken via `speak()`.
- "Stop" / `Escape` cancels every long-running state — recording, playback, comment-recording, in-flight upload.
- "Help" / `?` lists the commands above (1–2 sentences, ≤200 chars).
