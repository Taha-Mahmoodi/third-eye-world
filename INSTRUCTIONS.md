# Third Eye World — Build Instructions for Claude Code

> **For the human handing this to Claude Code:** This document is the contract. Drop it in the repo as `INSTRUCTIONS.md` (or `CLAUDE.md` — same file, different name). Claude Code should read this end-to-end before doing anything. If anything in here is unclear or seems wrong for your situation, push back *before* writing code.

---

## 0. How to use this document (read first)

You are building **Third Eye World** — a voice-first social network where every post is a voice memo, every action is a voice command, and the blind user is the default user, not an accommodation.

**Working agreement with Claude Code:**

1. **Always work on a branch.** Never commit directly to `main`. Create a branch → write code → test it → open a PR → an audit subagent reviews → only then merge.
2. **Every "major thing" is a PR.** New feature, bug fix, dependency change, schema change, doc change — all of it. Small focused PRs over giant ones.
3. **At every milestone, audit everything.** Use the audit checklists in Section 12. Nothing ships at less than an **A grade.** If you find a B, file it as a follow-up issue and fix it before moving to the next milestone.
4. **The human running this is non-technical.** Explain decisions in plain language in PR descriptions. Never assume they'll read the code — assume they'll read the title and description and trust the audits.
5. **Spawn subagents for specialized work.** See Section 7. Use them — don't try to be a generalist on accessibility or security.

---

## 1. Project overview

**One sentence:** A voice-first audio social network where blind users sign up, post, listen, like, and reply entirely by speaking, with a warm AI host (ElevenLabs voice) acknowledging every action.

**Demo goal:** A blind tester, on a fresh browser, eyes closed, screen reader on, can sign up by voice, post a memo, hear someone else's, like it, and reply — in under 5 minutes, with no sighted help and no visual cues.

**What we are NOT building in the demo:**
- Native iOS / Android apps (web only)
- Push notifications
- Production auth (no real password flow)
- Moderation tooling
- Follow graph / vanity metrics (intentionally never built)
- Multi-language support (English only for v1)

---

## 2. Hard rules (non-negotiable)

If any of these break, the demo is broken. No exceptions, no "we'll fix it later."

1. **No visual-first UX.** No timeline thumbnails, no avatars, no emoji reactions. Audio is the medium.
2. **One screen, one big button.** Every screen has at most one primary tactile control, properly labelled for screen readers.
3. **Every state change is audible.** Liking plays a sound + spoken "liked." Posting plays "posted." Errors are spoken, not flashed.
4. **The app is never silent after a user action.** If TTS fails, fall back. If the fallback fails, fall back again.
5. **Every voice command is cancellable.** "Stop" halts whatever is happening, always.
6. **Keyboard-only operability.** Every voice command has a keyboard equivalent. The app must be usable with no mouse and no microphone.
7. **WCAG 2.2 AAA as the floor.** Contrast, focus order, ARIA semantics, no time limits, reduced-motion respected.
8. **No CAPTCHAs, no visual puzzles, anywhere.**
9. **No API keys in the client.** Ever. All third-party calls go through our server.
10. **No spoken phrase is inlined in code.** Every spoken string lives in `client/src/strings.ts`. Single source of truth.

---

## 3. Tech stack (definitive)

Do not substitute these without writing a one-paragraph justification in a PR.

| Layer | Choice | Why |
|---|---|---|
| **Client framework** | Vanilla TypeScript + Vite | Frameworks add markup that fights screen readers. Our UI is one button per screen — frameworks are overhead. |
| **Audio capture** | `MediaRecorder` Web API | Native, no dependency. |
| **Speech-to-text (input)** | Whisper — OpenAI hosted API for demo, `whisper.cpp` self-hosted for prod | Best accuracy. Hosted is fast to ship; self-hosted is privacy-respecting. |
| **Voice command listener** | Web Speech API (`SpeechRecognition`) | Free, runs in browser, used for *short* commands only. Memos go through Whisper. |
| **LLM (intent + reply writer)** | **Qwen 2.5 32B Instruct**, 4-bit quantized, served via **Ollama** (dev) → **vLLM** (prod) | Excellent quality, strong multilingual, runs on a single GPU, OpenAI-compatible API. |
| **Text-to-speech (output)** | **ElevenLabs API** primary; Web Speech API fallback | The voice IS the UI. Quality matters more than anywhere else. |
| **Server** | Node.js 20 + Fastify + TypeScript | Small, fast, ergonomic. |
| **Database** | SQLite via `better-sqlite3` (demo) → Postgres (prod) | Single file, zero setup for demo. |
| **Audio storage** | Local filesystem `./uploads/audio/` (demo) → S3 (prod) | Same. |
| **Auth** | Signed cookie session, no password (demo); magic-link voice signup | No visual password UX to accessibility-audit. |
| **Testing** | Vitest (unit) + Playwright (E2E with screen-reader simulation) | Industry standard. Playwright supports a11y testing. |
| **Linting** | ESLint + Prettier + `eslint-plugin-jsx-a11y` | Catch a11y issues at lint time. |
| **CI** | GitHub Actions | Free for the demo, cheap forever. |
| **a11y CI tool** | `axe-core` via `@axe-core/playwright` | Industry-standard automated a11y testing. |

---

## 4. Environment variables

Create `.env.example` in repo root. Never commit `.env`.

```
# OpenAI (Whisper for demo)
OPENAI_API_KEY=

# ElevenLabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=    # picked after voice testing — see Section 11

# Local LLM (set when you have a GPU)
LLM_BASE_URL=http://localhost:11434/v1   # Ollama default
LLM_MODEL=qwen2.5:32b-instruct
LLM_API_KEY=ollama   # placeholder; vLLM/Ollama don't require a real key locally

# Server
PORT=3000
SESSION_SECRET=        # any 32+ random chars; generate with `openssl rand -hex 32`
NODE_ENV=development

# Storage (demo defaults are fine)
AUDIO_UPLOAD_DIR=./uploads/audio
```

---

## 5. Repo & git workflow (explicit, for the non-technical owner)

### Branches
- `main` is sacred. Production-ready, always green CI, always merged via PR.
- `feature/<short-name>` for new features (e.g. `feature/voice-onboarding`)
- `fix/<short-name>` for bug fixes
- `a11y/<short-name>` for accessibility improvements
- `chore/<short-name>` for tooling, deps, docs

### The loop (do this every time)
1. Pull latest `main`: `git checkout main && git pull`
2. Create a branch: `git checkout -b feature/foo`
3. Make changes. Commit often with **Conventional Commits**:
   - `feat: add voice onboarding flow`
   - `fix: prevent recording past 2 minutes`
   - `a11y: add aria-live region for command confirmations`
   - `chore: bump fastify to 4.27`
   - `docs: clarify tts fallback chain`
4. Run the local checks before pushing:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run test:a11y`
   - `npm run test:e2e`
5. Push the branch: `git push -u origin feature/foo`
6. Open a PR. Use the PR template (Section 6). Title in conventional-commit style.
7. CI runs. The relevant **audit subagent(s)** review. See Section 7.
8. Address feedback by pushing more commits to the same branch.
9. **Squash and merge** to `main` when all checks are green and audits pass.
10. Delete the branch.

### What "every major thing is a PR" means
- A new endpoint → its own PR
- A new screen → its own PR
- Adding ElevenLabs → its own PR (with a follow-up PR for the proxy cache)
- A schema migration → its own PR
- Wiring up the LLM → its own PR
- A bug fix → its own PR
- A new dependency → its own PR with the one-paragraph justification

If a PR description starts to grow into "and also…", **stop, split it.**

### PR template (commit this as `.github/pull_request_template.md`)

```markdown
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
```

---

## 6. Repo layout

```
/
├── INSTRUCTIONS.md            ← this file (source of truth)
├── README.md                  ← 3-command quick start
├── .env.example
├── .gitignore
├── .github/
│   ├── pull_request_template.md
│   └── workflows/
│       ├── ci.yml             ← lint, typecheck, test, a11y, e2e
│       └── audit.yml          ← runs subagents on milestone tags
├── .claude/
│   ├── agents/                ← subagent definitions (Section 7)
│   │   ├── code-reviewer.md
│   │   ├── accessibility-auditor.md
│   │   ├── security-auditor.md
│   │   ├── voice-ux-specialist.md
│   │   ├── performance-auditor.md
│   │   └── test-engineer.md
│   └── skills/                ← project-specific skills (Section 8)
│       ├── voice-grammar/
│       ├── elevenlabs-integration/
│       ├── a11y-checklist/
│       └── third-eye-tone/
├── scripts/
│   ├── generate-phrases.ts    ← pre-generates ElevenLabs MP3s at build time
│   └── audit.ts               ← runs the milestone audit suite
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── memos.ts
│   │   │   ├── comments.ts
│   │   │   ├── likes.ts
│   │   │   ├── tts.ts         ← ElevenLabs proxy + cache
│   │   │   ├── stt.ts         ← Whisper proxy
│   │   │   └── llm.ts         ← Local LLM proxy + tool dispatcher
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   └── client.ts
│   │   ├── llm/
│   │   │   ├── system-prompt.ts
│   │   │   ├── tools.ts       ← OpenAI-style tool definitions
│   │   │   └── dispatcher.ts  ← maps tool calls to backend actions
│   │   └── lib/
│   │       ├── session.ts
│   │       └── audio-store.ts
│   ├── uploads/               ← gitignored
│   └── tests/
├── client/
│   ├── public/
│   │   └── audio/phrases/     ← pre-generated ElevenLabs MP3s (committed)
│   ├── src/
│   │   ├── audio/             ← MediaRecorder + playback queue
│   │   ├── voice/             ← speech recognition + TTS playback
│   │   ├── commands/          ← keyboard equivalents + dispatcher
│   │   ├── strings.ts         ← SINGLE SOURCE for all spoken phrases
│   │   ├── ui/                ← the one big button per screen
│   │   └── main.ts
│   ├── tests/
│   └── index.html
└── docs/
    ├── architecture.md        ← updated as the system evolves
    ├── voice-grammar.md       ← what users can say
    ├── llm-tools.md           ← tool-call schema
    ├── tts-strategy.md        ← ElevenLabs proxy + caching
    ├── a11y-checklist.md      ← WCAG 2.2 AAA checklist
    └── runbook.md             ← what to do when something breaks
```

---

## 7. Subagents to spawn

Claude Code supports custom subagents defined in `.claude/agents/*.md`. Below are the six subagents this project requires. Create each one as a separate file. Each should have a clear trigger condition and a focused job.

### 7.1 `code-reviewer.md`
**Triggers on:** Every PR before merge.
**Job:** Read the diff. Check for: dead code, missing error handling, magic numbers, inconsistent naming, unsafe type assertions, TODOs without owners, missing tests for new logic, anything that violates the conventions in Section 13.
**Authority:** Can request changes. Cannot approve PRs that touch a11y, security, or voice UX without those specialists also approving.

### 7.2 `accessibility-auditor.md`
**Triggers on:** Any PR that touches `client/`, especially UI markup, focus management, ARIA attributes, or voice flow.
**Job:** Run automated `axe-core` checks. Manually trace through the screen-reader experience. Verify focus order, ARIA live regions, keyboard equivalents for every voice command, contrast ratios, no time limits, reduced-motion support. Confirm WCAG 2.2 **AAA** compliance, not just AA.
**Authority:** Can block merge. A11y blocks override velocity.

### 7.3 `security-auditor.md`
**Triggers on:** PRs touching auth, sessions, file uploads, third-party API calls, environment variables, or anything network-exposed. Always at milestone audits.
**Job:** Check for: API keys in client code, SQL injection risks, unbounded uploads, missing rate limits, missing input validation, CSRF gaps, insecure cookie flags, unscoped CORS, prompt-injection risks in LLM inputs, dependency CVEs (`npm audit`).
**Authority:** Can block merge.

### 7.4 `voice-ux-specialist.md`
**Triggers on:** Any PR touching `client/src/voice/`, `client/src/commands/`, `client/src/strings.ts`, or the LLM system prompt.
**Job:** Verify every interaction has spoken feedback. Verify every voice command has a keyboard equivalent. Verify the tone matches the `third-eye-tone` skill. Verify spoken phrases are short, warm, and clear. Verify the fallback chain (ElevenLabs → cached MP3 → Web Speech) works in all three states.
**Authority:** Can block merge on voice flow regressions.

### 7.5 `performance-auditor.md`
**Triggers on:** Milestone audits, plus any PR adding dependencies or touching the audio/voice pipeline.
**Job:** Measure: client bundle size (target <150KB gzipped for v1), first-contentful-paint on simulated 3G (target <2s), end-to-end voice latency (user stops speaking → first audio byte from ElevenLabs, target <1.5s). Flag regressions >10%.
**Authority:** Can request changes; cannot block unless regression >25%.

### 7.6 `test-engineer.md`
**Triggers on:** Any PR adding new logic without tests.
**Job:** Write the tests. Unit tests for pure functions, integration tests for routes, E2E tests for full voice loops. Target >80% coverage on `server/src/llm/`, `server/src/routes/`, and `client/src/voice/`. Lower targets fine for UI glue.
**Authority:** Can request changes.

### Subagent file template (use this for each)

```markdown
---
name: <subagent-name>
description: When this subagent should be invoked. Be specific.
tools: <comma-separated tools, e.g., Read, Grep, Bash>
---

You are the <role> for the Third Eye World project. Your single job is <one sentence>.

## When you run
<trigger conditions>

## What you check
<bulleted, specific checklist>

## What you produce
<format of your output — usually a PR comment with checklist + grade>

## Hard rules
- You cannot approve a PR that fails any item in your checklist.
- You explain findings in plain English (the project owner is non-technical).
- You grade your section A / B / C / F. Only A is acceptable for merge.
```

---

## 8. Skills to use

Claude Code supports project skills in `.claude/skills/`. Create these four. Each is a folder with a `SKILL.md` and any supporting reference docs.

### 8.1 `voice-grammar/`
The canonical list of utterances the app recognizes, their synonyms, and the action each maps to. Update this whenever a command is added or changed.

### 8.2 `elevenlabs-integration/`
How to call the ElevenLabs proxy correctly. Voice settings. Pre-generated vs streamed. Cache key format. Fallback chain. Cost guardrails.

### 8.3 `a11y-checklist/`
WCAG 2.2 AAA checklist tailored to this app. Used by the `accessibility-auditor` subagent. Should be exhaustive — focus order, ARIA roles, contrast, motion, time limits, keyboard equivalents, screen-reader tested phrases.

### 8.4 `third-eye-tone/`
The voice and personality of the AI host. Tone examples (good and bad). Length rules (1–2 short sentences, never a paragraph). Forbidden phrases ("As an AI…", "I'm sorry, but…" twice in a row, etc.). Used by the LLM system prompt and by `voice-ux-specialist`.

Anthropic also ships built-in skills you should use when relevant:
- `frontend-design` — for any web UI work
- `pdf` / `docx` — if generating user-facing documents (not in scope for v1)

---

## 9. Build phases & tasks

Each phase ends with a milestone audit (Section 12). Do not start the next phase until the current phase's audit is an A.

### Phase 0 — Foundation (Day 1)
**Branch prefix:** `chore/`
**Tasks:**
1. `chore/repo-init` — `git init`, `.gitignore`, `README.md` (3-command quick start), `.env.example`, MIT license.
2. `chore/ci-skeleton` — GitHub Actions workflow with lint, typecheck, test, a11y, e2e jobs (most can be no-ops at this point).
3. `chore/pr-template` — `.github/pull_request_template.md` from Section 5.
4. `chore/subagents` — Create all six subagent files in `.claude/agents/` per Section 7.
5. `chore/skills` — Create all four skill folders in `.claude/skills/` per Section 8 (skeletons OK).
6. `chore/server-skeleton` — Fastify server with `GET /health`. Vitest configured. One passing test.
7. `chore/client-skeleton` — Vite + TS client with one accessible `<button>Record</button>` and a hidden `<div role="status" aria-live="polite">` for spoken feedback. Playwright configured with one a11y test using `axe-core`.

**Audit:** Phase 0 audit. CI green, all checklists pass.

### Phase 1 — Record + play loop (Days 2–3)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/audio-recorder` — `MediaRecorder` wrapper (start, stop, returns Blob). Unit tests with mocked MediaRecorder.
2. `feature/memos-schema` — DB migration creating `users`, `memos` tables.
3. `feature/post-memo-endpoint` — `POST /api/memos` accepts multipart audio, saves to disk, writes row.
4. `feature/list-memos-endpoint` — `GET /api/memos`.
5. `feature/audio-stream-endpoint` — `GET /api/memos/:id/audio`.
6. `feature/playback-queue` — Client auto-plays memos in sequence.
7. `feature/spoken-feedback-fallback` — Wire Web Speech API SpeechSynthesis as the *fallback* TTS now (we'll add ElevenLabs in Phase 3). Spoken confirmations after record/post.

**Audit:** Phase 1 audit. Eyes-closed test: can a sighted dev with eyes closed and VoiceOver on record and hear back a memo?

### Phase 2 — Voice commands + keyboard equivalents (Days 4–5)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/voice-grammar-skill` — Populate `.claude/skills/voice-grammar/` with the canonical command list.
2. `feature/strings-file` — Create `client/src/strings.ts` with all v1 phrases.
3. `feature/command-listener` — Always-on Web Speech API listener, restarts on `end`.
4. `feature/command-parser` — Maps utterances to actions. Handles synonyms (`like` ≡ `heart`).
5. `feature/keyboard-equivalents` — Space = pause/resume, → = next, ← = previous, L = like, C = comment.
6. `feature/help-command` — Says the command list when user says "help."

**Audit:** Phase 2 audit. Voice + keyboard reach feature parity.

### Phase 3 — ElevenLabs integration (Days 6–7)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/elevenlabs-skill` — Populate `.claude/skills/elevenlabs-integration/`.
2. `feature/tts-proxy` — `GET /api/tts?text=…&voice=…` server endpoint. Holds API key. Streams audio. Caches by `(text, voice, settings)` hash on disk.
3. `feature/phrase-pregenerator` — `scripts/generate-phrases.ts`. Reads `strings.ts`. Generates each phrase once. Writes MP3s to `client/public/audio/phrases/<key>.mp3`. Committed.
4. `feature/client-tts-player` — Tries pre-generated MP3 → falls back to streamed `/api/tts` → falls back to Web Speech API. Single `speak(key)` function the rest of the app uses.
5. `feature/voice-selection-test-page` — `/_internal/voices` page that plays the same phrase in 4 candidate ElevenLabs voices side by side. Tester picks one. Selection committed to `.env.example`.

**Audit:** Phase 3 audit. **Voice quality test with at least one blind tester before merging.**

### Phase 4 — Comments + likes (Days 8–9)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/likes-schema-and-endpoints` — `POST /api/memos/:id/like`, `DELETE` same. `likes` table.
2. `feature/comments-schema-and-endpoints` — `POST /api/memos/:id/comments` (multipart), `GET` same. `comments` table.
3. `feature/like-by-voice` — Says "liked" via ElevenLabs.
4. `feature/comment-by-voice` — Triggers a recording flow, posts on completion.
5. `feature/replies-announcement` — After playing a memo, "This memo has 3 replies. Say replies to hear them."

**Audit:** Phase 4 audit. Full social loop works by voice.

### Phase 5 — Local LLM (Days 10–12)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/llm-tools-doc` — Write `docs/llm-tools.md` with the full tool-call schema (Section 11).
2. `feature/llm-system-prompt` — `server/src/llm/system-prompt.ts`. Includes the tone rules from `third-eye-tone` skill.
3. `feature/llm-proxy` — `POST /api/llm` server endpoint. Calls `LLM_BASE_URL` (Ollama in dev, vLLM in prod). Returns parsed tool calls + spoken reply.
4. `feature/llm-dispatcher` — Maps tool calls to backend actions. Executes them. Returns the LLM's spoken reply to the client.
5. `feature/whisper-proxy` — `POST /api/stt`. Sends audio to OpenAI Whisper. Returns transcript.
6. `feature/full-pipeline-wiring` — Wire client: record voice → `/api/stt` → `/api/llm` (with current memo context) → execute → ElevenLabs reply.
7. `feature/llm-fallback` — If LLM call fails or times out (>2s), fall back to deterministic command parser from Phase 2. App must never freeze.

**Audit:** Phase 5 audit. Full AI loop. Latency budget met.

### Phase 6 — Voice onboarding (Day 13)
**Branch prefix:** `feature/`
**Tasks:**
1. `feature/onboarding-flow` — First visit (no session cookie) → spoken welcome → "Say your name after the tone" → record → Whisper transcribe → confirm by playback → create user + session.
2. `feature/no-text-inputs` — Audit confirms: there are zero `<input type="text">` elements in the entire app.

**Audit:** Phase 6 audit. End-to-end blind-tester run.

### Phase 7 — Polish, hardening, demo video (Day 14)
**Branch prefix:** `chore/` and `a11y/`
**Tasks:**
1. `a11y/full-pass` — Run NVDA on Windows, VoiceOver on macOS Safari, VoiceOver on iOS Safari. Fix everything.
2. `chore/load-test` — Simulate 50 concurrent users on the LLM endpoint. Confirm latency budget holds.
3. `chore/runbook` — Write `docs/runbook.md` covering: API key rotation, what to do if the LLM box dies, how to roll back a bad deploy.
4. `chore/demo-video` — Record a 2-minute screen recording with a real blind user using the app eyes-closed. **This is the deliverable.**

**Audit:** **Final milestone audit.** A grade across every category. If any subagent grades below A, fix and re-audit before declaring done.

---

## 10. Voice + AI architecture (the full pipeline)

```
User speaks
   │
   ▼
[Browser] MediaRecorder captures audio
   │
   ▼
[Browser] Sends audio to /api/stt
   │
   ▼
[Server] /api/stt → OpenAI Whisper → transcript
   │
   ▼
[Server] /api/llm with transcript + current context (current memo, user, etc.)
   │
   ▼
[Local GPU box] Qwen 2.5 32B via Ollama/vLLM
   │   - Picks tool call(s): like, comment, next, etc.
   │   - Writes the spoken reply
   ▼
[Server] Dispatcher executes tool calls (DB writes, etc.)
   │
   ▼
[Server] Sends spoken reply text to /api/tts
   │
   ▼
[Server] /api/tts → ElevenLabs streaming → MP3 chunks
   │
   ▼
[Browser] Plays MP3 chunks via <audio> as they arrive
   │
   ▼
User hears warm, natural voice within ~1.1–1.3s
```

**Latency budget:**
- Whisper: ~300ms
- LLM (Qwen 32B 4-bit on H100): ~500ms
- ElevenLabs first chunk: ~400ms
- **Total: ~1.2s** — acceptable for voice

If end-to-end exceeds 1.5s, performance-auditor blocks merge.

---

## 11. ElevenLabs integration (summary)

Full details in `docs/tts-strategy.md`. Key points:

- **Two tiers:**
  - **Pre-generated MP3s** for fixed phrases (16 of them — see `client/src/strings.ts`). Generated once at build via `scripts/generate-phrases.ts`. Shipped with the app.
  - **Streamed dynamic** for phrases with variables ("Memo from Asha, posted two minutes ago"). Server-side cached by phrase hash.
- **Voice selection:** Test 3–4 ElevenLabs voices with real users before committing. Default candidates: Rachel, Bella, Adam.
- **Settings:** `stability: 0.5, similarity_boost: 0.75, model: eleven_turbo_v2_5` for streaming, `eleven_multilingual_v2` for pre-baked.
- **Server-side proxy** at `/api/tts`. Browser never sees the API key.
- **Fallback chain:** ElevenLabs streaming → cached MP3 → Web Speech API. App must never go silent.
- **Cost guardrails:** Pre-gen ~50 phrases (pennies, paid once). 200-char cap on dynamic. Aggressive server-side cache. Monthly budget alarm on the ElevenLabs account.

---

## 12. Local LLM (Qwen 2.5 32B) setup

### Dev (your laptop)
```bash
# Install Ollama: https://ollama.com/download
ollama pull qwen2.5:32b-instruct
ollama serve   # exposes OpenAI-compatible API at localhost:11434
```

Set `LLM_BASE_URL=http://localhost:11434/v1` in `.env`. Done.

### Prod (single GPU box, rented)
- **Hardware:** 1× H100 80GB (RunPod ~$2/hr, Lambda ~$2.5/hr) OR 1× A100 80GB (~$1.5/hr)
- **Software:** vLLM (`pip install vllm`)
- **Command:**
  ```bash
  vllm serve Qwen/Qwen2.5-32B-Instruct \
    --quantization awq \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.9 \
    --port 8000
  ```
- **API:** OpenAI-compatible at `http://<box-ip>:8000/v1`

### Tool-call contract

The LLM is called with a strict set of tools. The full schema lives in `docs/llm-tools.md`. Summary:

```typescript
type LLMTools = {
  like_memo:     { memo_id: string };
  unlike_memo:   { memo_id: string };
  start_comment: { memo_id: string };
  next_memo:     {};
  previous_memo: {};
  pause:         {};
  resume:        {};
  post_recording: {};
  cancel:        {};
  speak_help:    {};
  // The model ALWAYS includes one of these:
  speak: { phrase: string };  // 1–2 short sentences, max 200 chars
};
```

The system prompt (full version in `server/src/llm/system-prompt.ts`) enforces:
- Always emit a `speak` tool call so the user gets feedback.
- Spoken phrases are 1–2 short sentences. No lists, no markdown, no parentheses.
- Confirm what just happened, then optionally offer one next step.
- Tone matches the `third-eye-tone` skill.

### Hardware crossover decision
- <50 daily active users → Ollama on a single rented A100 ($300–500/mo, kill at night)
- 50–500 DAU → vLLM on a dedicated H100 (~$2k/mo)
- 500+ DAU → multi-GPU or move to a hosted inference provider (Fireworks, Together AI) running the same Qwen model

---

## 13. API surface

```
POST   /api/auth/signup           multipart audio (name)         → session
POST   /api/auth/logout                                          → ok
GET    /api/auth/me                                              → { user }

GET    /api/memos                 ?cursor=&limit=                → [{ id, user, duration, audio_url }]
POST   /api/memos                 multipart audio                → memo
GET    /api/memos/:id/audio                                      → audio stream

POST   /api/memos/:id/like                                       → { liked: true, count }
DELETE /api/memos/:id/like                                       → { liked: false, count }

GET    /api/memos/:id/comments                                   → [{ id, user, duration, audio_url }]
POST   /api/memos/:id/comments    multipart audio                → comment

POST   /api/stt                   multipart audio                → { transcript }
POST   /api/llm                   { transcript, context }        → { tool_calls, speak }
GET    /api/tts                   ?text=&voice=                  → audio stream (cached)
```

All endpoints rate-limited per session. All inputs validated with `zod`. All audio uploads capped at 5MB / 2 minutes.

---

## 14. Definition of "A grade" (used at every milestone audit)

A milestone is graded **A** when *every* category below is graded A by its responsible subagent. Anything less is not done.

| Category | A grade means | Subagent |
|---|---|---|
| **Code quality** | TypeScript strict mode, zero `any`, ESLint clean, Prettier clean, no TODOs without owners, no commented-out code | `code-reviewer` |
| **Tests** | >80% coverage on `server/src/llm/`, `server/src/routes/`, `client/src/voice/`. All unit + integration + E2E tests passing | `test-engineer` |
| **Accessibility** | WCAG 2.2 **AAA** verified by axe-core + manual NVDA + manual VoiceOver. Every voice command has keyboard equivalent. Every state change is audible. Reduced-motion respected. | `accessibility-auditor` |
| **Voice UX** | Every interaction confirmed by ElevenLabs voice. Tone matches `third-eye-tone` skill. Fallback chain works in all 3 states. No spoken phrase is awkward, robotic, or repetitive. | `voice-ux-specialist` |
| **Security** | No secrets in client or git history. All inputs validated. All endpoints rate-limited. `npm audit` clean. CORS scoped. Cookies secure + httpOnly + sameSite. No prompt-injection vectors in LLM input handling. | `security-auditor` |
| **Performance** | Bundle <150KB gzipped. FCP <2s on simulated 3G. End-to-end voice latency <1.5s. No memory leaks in 1-hour session simulation. | `performance-auditor` |

If a milestone has **any** B grade, file follow-up issues and fix before next phase. The owner is non-technical — "A grade" is the abstraction they care about.

---

## 15. Milestone audit checklist (run at end of each phase)

The human owner can verify these without reading code. Each subagent posts a final report on the milestone PR with these answers.

```markdown
## Milestone audit: Phase <N>

### Code quality (code-reviewer): A / B / C / F
- [ ] Lint clean: yes / no
- [ ] Typecheck clean: yes / no
- [ ] No new `any` types: yes / no
- [ ] No commented-out code: yes / no
- [ ] No TODOs without owner+date: yes / no
- Notes:

### Tests (test-engineer): A / B / C / F
- [ ] Unit coverage >80% on critical paths: __%
- [ ] All E2E tests passing: yes / no
- [ ] New code has tests: yes / no
- Notes:

### Accessibility (accessibility-auditor): A / B / C / F
- [ ] axe-core: 0 violations
- [ ] NVDA full-flow walkthrough: pass / fail
- [ ] VoiceOver (macOS) full-flow walkthrough: pass / fail
- [ ] VoiceOver (iOS Safari) full-flow walkthrough: pass / fail
- [ ] Every voice command has a keyboard equivalent: yes / no
- [ ] Every state change is audible: yes / no
- [ ] No `<input type="text">` anywhere in the app: confirmed / found at <location>
- [ ] Reduced-motion respected: yes / no
- Notes:

### Voice UX (voice-ux-specialist): A / B / C / F
- [ ] All ElevenLabs phrases sound natural: yes / no
- [ ] Fallback to cached MP3 works (test with API key removed): yes / no
- [ ] Fallback to Web Speech works (test with cache cleared and API key removed): yes / no
- [ ] LLM tone matches third-eye-tone skill: yes / no
- [ ] No phrase >200 chars: confirmed
- [ ] No phrase contains lists/markdown/emojis: confirmed
- Notes:

### Security (security-auditor): A / B / C / F
- [ ] No API keys in client bundle (grep proves it): confirmed
- [ ] No secrets in git history (`gitleaks` clean): confirmed
- [ ] `npm audit` clean (no high/critical): yes / no
- [ ] All inputs validated with zod: yes / no
- [ ] All endpoints rate-limited: yes / no
- [ ] Cookies: Secure + HttpOnly + SameSite=Lax: confirmed
- [ ] LLM input sanitized for prompt injection: confirmed
- Notes:

### Performance (performance-auditor): A / B / C / F
- [ ] Client bundle gzipped: __KB (target <150KB)
- [ ] FCP on simulated 3G: __s (target <2s)
- [ ] End-to-end voice latency p50: __ms (target <1500ms)
- [ ] End-to-end voice latency p95: __ms
- [ ] Memory stable over 1hr session: yes / no
- Notes:

### Overall milestone grade: A / B / C / F
### Cleared to start next phase? yes / no
```

---

## 16. Conventions

- **Conventional commits** (`feat:`, `fix:`, `chore:`, `a11y:`, `docs:`, `test:`).
- **Squash and merge.** History stays clean.
- **No new dependency without one-paragraph justification** in PR description.
- **No spoken phrase inlined** anywhere except `client/src/strings.ts`.
- **Audio files are immutable.** No edit endpoints. Delete-and-repost only.
- **Plain English in PR descriptions.** The owner is non-technical.
- **Branch names are short and descriptive.** `feature/voice-onboarding`, not `feature/add-voice-onboarding-flow-with-name-recording`.

---

## 17. First-session checklist for Claude Code

Do these in order, on the first session, before writing any feature code.

1. Read this `INSTRUCTIONS.md` end-to-end.
2. `git init`. Create the `main` branch with one initial commit (this file + `README.md`).
3. Open a draft PR named `chore/repo-init` from a new branch — practice the workflow on day one.
4. Create the six subagent files in `.claude/agents/` (Section 7). Each gets its own PR.
5. Create the four skill folders in `.claude/skills/` (Section 8). Skeletons are fine; flesh them out as you go.
6. Set up CI (`chore/ci-skeleton`) — even no-op jobs for now. CI must be green before any feature code.
7. Stand up the server skeleton (`chore/server-skeleton`) with `GET /health` and one passing test.
8. Stand up the client skeleton (`chore/client-skeleton`) with one button and one a11y test.
9. **Now and only now,** start Phase 1.

If you find yourself wanting to skip steps to "go faster" — don't. The audit subagents will catch it and you'll have to backfill anyway, with worse context.

---

## 18. When something breaks (for the human)

- **A subagent says something is below A grade:** Read the report. Ask Claude Code to fix it. Don't merge.
- **CI is red:** Don't merge. Ask Claude Code why and to fix it.
- **A blind tester says something feels wrong:** That overrides everything in this document. Update the document, then update the code.
- **Costs spike:** Pre-generated phrases should cover >90% of TTS calls. If they don't, something's wrong with the cache. Check `docs/runbook.md`.
- **The LLM box goes down:** The fallback parser from Phase 2 keeps the app working in degraded mode. The app gives a quieter "I'm having trouble understanding right now — try the basics like next, like, or comment." Diagnose later; users don't get blocked.

---

## 19. Reminder of the product principle

The blind user is the **default** user. Not an accommodation, not an edge case, not "also supported." The default. If something would only make sense to a sighted developer, it doesn't belong in the demo.

Build it like that, and you'll have something nobody else has built.
