## What this changes
One paragraph in plain English. The non-technical reviewer will read this.

## Why
Reference the section of INSTRUCTIONS.md or the user need this serves.

## How to test it manually
Step-by-step. Assume the reviewer is sighted; also call out the blind-user path.

## Audits run
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run test` passing
- [ ] `npm run test:a11y` passing
- [ ] `npm run test:e2e` passing
- [ ] Screen-reader-tested manually (NVDA / VoiceOver) — describe what you heard
- [ ] No new dependencies, OR justification provided below
- [ ] No spoken phrases inlined in code (all in `strings.ts`)
- [ ] No API keys in client code

## New dependency justification (if any)
N/A or one paragraph.

## Subagents that reviewed this
- [ ] code-reviewer
- [ ] accessibility-auditor (if UI changed)
- [ ] security-auditor (if auth/storage/API surface changed)
- [ ] voice-ux-specialist (if any voice interaction changed)
