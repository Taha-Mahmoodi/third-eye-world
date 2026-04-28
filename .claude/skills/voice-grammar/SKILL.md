---
name: voice-grammar
description: The canonical list of utterances the Third Eye World app recognizes, their synonyms, and the action each maps to. Used by the command parser, the LLM system prompt, and the voice-ux-specialist subagent. Update whenever a command is added or changed.
---

# Voice grammar

This skill is the single source of truth for what users can say. It is referenced by:
- `client/src/commands/` — the command parser and dispatcher
- `server/src/llm/system-prompt.ts` — so the LLM knows which tool calls map to which utterances
- `.claude/agents/voice-ux-specialist.md` — when auditing keyboard-equivalent coverage

## Status

**Skeleton.** Populated in Phase 2 (`feature/voice-grammar-skill`, INSTRUCTIONS.md § 9). Until then, this file is the placeholder.

## Format (when populated)

Each command entry has:
- **Action** — the canonical name (matches the LLM tool name, e.g. `like_memo`, `next_memo`, `start_comment`).
- **Primary utterance** — the most natural phrasing.
- **Synonyms** — every other phrasing that maps to the same action.
- **Keyboard equivalent** — the shortcut for sighted/keyboard-only users (every voice command has one — INSTRUCTIONS.md § 2 #6).
- **What happens** — one sentence, plain English.
- **What the user hears back** — the spoken confirmation key from `client/src/strings.ts`.

## Initial command set (target for v1, finalized in Phase 2)

A non-binding draft so reviewers know what's coming:

| Action | Primary utterance | Synonyms | Keyboard | Confirmation |
|---|---|---|---|---|
| `next_memo` | "next" | "skip", "next memo" | → | "next memo" |
| `previous_memo` | "previous" | "back", "go back" | ← | "previous memo" |
| `pause` | "pause" | "wait", "hold on" | Space | "paused" |
| `resume` | "resume" | "play", "continue" | Space | "playing" |
| `like_memo` | "like" | "heart", "love this" | L | "liked" |
| `unlike_memo` | "unlike" | "remove like", "unlike this" | Shift+L | "unliked" |
| `start_comment` | "comment" | "reply", "respond" | C | "go ahead" + record tone |
| `post_recording` | "post" | "send", "share" | Enter | "posted" |
| `cancel` | "stop" | "cancel", "never mind" | Esc | "cancelled" |
| `speak_help` | "help" | "what can I say", "commands" | ? | full command list spoken |

## Hard rules
- "Stop" must always work (INSTRUCTIONS.md § 2 #5). It is the kill switch — every state must accept it.
- Every voice command must have a keyboard equivalent (§ 2 #6). New entries without a keyboard column are a fail at audit.
- Synonyms exist so users do not have to memorize. Add them generously; remove only if they collide.
- The LLM in Phase 5 may interpret freeform speech, but it must still resolve to one of these actions plus a `speak` reply (§ 12).
