---
name: a11y-checklist
description: WCAG 2.2 AAA checklist tailored to Third Eye World, the canonical source for the accessibility-auditor subagent. Exhaustive — focus order, ARIA roles, contrast, motion, time limits, keyboard equivalents, screen-reader tested phrases.
---

# Accessibility checklist (WCAG 2.2 AAA, tailored)

This skill is the canonical checklist used by the `accessibility-auditor` subagent. The blind user is the default user (INSTRUCTIONS.md § 19), so AA is a fail and AAA is the floor.

## Status

**Skeleton.** The checklist below is the v0 floor; flesh out as features land. Every new feature should add or confirm the rows that apply to it.

## Automated

- [ ] `axe-core` via `@axe-core/playwright`: 0 violations on every screen the change touches.
- [ ] `eslint-plugin-jsx-a11y` clean. No rules disabled without an inline justification + linked issue.

## Markup & semantics

- [ ] Every interactive element has an accessible name (visible label, `aria-label`, or `aria-labelledby`).
- [ ] Buttons are `<button>`. Links are `<a>`. No styled `<div onClick>`.
- [ ] Heading order is logical and not skipped. One `<h1>` per route.
- [ ] Live region `<div role="status" aria-live="polite">` exists and is updated for non-urgent state changes; `aria-live="assertive"` only for genuinely urgent messages.
- [ ] Form-like controls have labels even when there is no visible label (`aria-label`).
- [ ] `<input type="text">` does **not** appear anywhere in the app (INSTRUCTIONS.md § 2 #8 + § 6.2).

## Focus & keyboard

- [ ] Tab order matches reading order on every screen.
- [ ] Visible focus indicator on every focusable element. Contrast ≥ 3:1 against background.
- [ ] No focus traps except in deliberate modals; modals have a visible close + Esc closes them.
- [ ] Every voice command has a keyboard equivalent (§ 2 #6). See `voice-grammar` skill for the canonical mapping.
- [ ] **Esc** cancels whatever is happening — recording, playback, comment-flow, modal — always (§ 2 #5).
- [ ] No keyboard-only user is stuck on any screen.

## Audible feedback

- [ ] Every state change is audible (record start, record stop, post, like, unlike, comment, navigation, error) — § 2 #3.
- [ ] The app is never silent after a user action — § 2 #4. Fallback chain fires if TTS fails.
- [ ] Errors are spoken, not flashed visually only.
- [ ] aria-live region updates *and* TTS plays — both, not one.
- [ ] No spoken phrase inlined outside `client/src/strings.ts` — § 2 #10.

## Sensory & motion

- [ ] Contrast ratios meet AAA: 7:1 for normal text, 4.5:1 for large text (≥ 18 pt or ≥ 14 pt bold).
- [ ] No information conveyed by color alone (e.g. red = error must also have an icon, label, or spoken cue).
- [ ] `@media (prefers-reduced-motion: reduce)` respected. Essential animations have a non-animated fallback.
- [ ] No flashing > 3 Hz (seizure safety).
- [ ] No CAPTCHAs or visual puzzles anywhere — § 2 #8.

## Time

- [ ] No time limits on any user action (WCAG 2.2 AAA — also called out in § 2).
- [ ] Recording stops at the 2-minute cap (§ 13) but only after a clear spoken warning before stopping.
- [ ] Session timeouts (if any) give the user a way to extend without losing work.

## Screen-reader walkthrough (manual, every milestone — § 15)

For each environment, do the full happy-path flow eyes closed and write down what you heard at each step:

- [ ] **NVDA on Windows** (Firefox + Chrome) — pass / fail
- [ ] **VoiceOver on macOS Safari** — pass / fail
- [ ] **VoiceOver on iOS Safari** — pass / fail

If a step is silent or unclear, that step is a **fail**, regardless of what the visual UI says.

## Demo target (§ 1)

A blind tester, on a fresh browser, eyes closed, screen reader on, can:
1. Sign up by voice
2. Post a memo
3. Hear someone else's memo
4. Like it
5. Reply

In under 5 minutes, with no sighted help and no visual cues. If any step in this flow fails the checklist above, the demo is not ready.

## Hard rules

- AAA is the floor. AA is a fail.
- Anything a sighted developer would notice but a blind user would not — does not belong (§ 19).
- A blind tester saying "this feels wrong" overrides this whole document (§ 18).
