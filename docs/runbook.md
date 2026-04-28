# Runbook

Phase 7 task 3 per [INSTRUCTIONS.md § 9](../INSTRUCTIONS.md). What to do when something goes wrong.

The owner is non-technical — every section answers a question in plain English. If you're reading this because something broke, scan the table of contents and jump.

## Contents

1. [The app feels silent](#the-app-feels-silent)
2. [Recording / posting fails](#recording--posting-fails)
3. [The voice sounds robotic (Web Speech) when it shouldn't](#the-voice-sounds-robotic-web-speech-when-it-shouldnt)
4. [The LLM box dies](#the-llm-box-dies)
5. [API costs spike](#api-costs-spike)
6. [Rotating an API key](#rotating-an-api-key)
7. [Rotating the session secret](#rotating-the-session-secret)
8. [Rolling back a bad deploy](#rolling-back-a-bad-deploy)
9. [Clearing caches](#clearing-caches)
10. [Common API error codes](#common-api-error-codes)
11. [Disk + DB hygiene](#disk--db-hygiene)

---

## The app feels silent

§ 2 #4: "The app is never silent after a user action." If it is, this is a P0.

**Quick triage:**

1. Open browser DevTools → Console. Are there errors?
   - `parameter 1 is not of type 'SpeechSynthesisUtterance'` → some test stub leaked into prod. Hard refresh the page.
   - 4xx / 5xx on `/api/...` → see [Common API error codes](#common-api-error-codes).
2. DevTools → Network tab. Click Record / Stop and watch the requests:
   - `/api/memos` should `201`.
   - `/api/memos` (GET) should `200` with a `memos: [...]` array.
   - `/api/memos/<id>/audio` should `200` with audio bytes.
3. The aria-live region (`#status` on the home page) should still update — even if no audio plays. If it doesn't, JS on the page broke. Check the build is current.

**The fallback chain (defense in depth — § 11):**

When ElevenLabs is enabled, `speak()` tries pre-baked MP3 → server proxy → ElevenLabs streaming → Web Speech. **If all four fail, the live region still updates.** A truly silent app means the JS itself didn't run.

---

## Recording / posting fails

The user hears `RECORDING_FAILED` ("I couldn't post that. Try again.") or
`RECORDING_PERMISSION_DENIED`.

**Permission denied:**
- The browser blocked microphone access. Check the address bar's site permissions.
- Some browsers (Safari) require an explicit user gesture. Click the Record button (don't just press R).

**Generic failure:**
- DevTools → Network: which request failed?
  - `POST /api/memos` 4xx / 5xx → see [Common API error codes](#common-api-error-codes).
  - `GET /api/memos` 5xx → server is broken; check `server` logs.

---

## The voice sounds robotic (Web Speech) when it shouldn't

The four-link chain (§ 11) only falls through to Web Speech (link 4) when the higher-quality links failed. If you expect ElevenLabs voice but hear the OS Web Speech voice:

1. Confirm `ELEVENLABS_API_KEY` is set on the server.
2. Confirm `ELEVENLABS_ENABLED` is `true` in `client/src/voice/speak.ts` (Phase 3 ships it as `false` for local-only mode — see [README.md](../README.md) "Going beyond local-only").
3. Confirm `client/public/audio/phrases/` is populated. If empty:
   ```
   ELEVENLABS_API_KEY=sk_... \
   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM \
   npm run generate:phrases
   ```
4. Confirm the Vite dev server is proxying `/api/*` to `:3000`. The `vite.config.ts` does this automatically; if you replaced it, double-check.

---

## The LLM box dies

§ 18: "The fallback parser from Phase 2 keeps the app working in degraded mode."

Symptoms:
- The user hears `STRINGS.DEGRADED_MODE` ("I'm having trouble understanding right now…") more often than usual.
- Server logs show `tts upstream error` or `llm timeout`.

**Diagnose:**
- Is `LLM_BASE_URL` reachable from the server? `curl $LLM_BASE_URL/v1/models` should work.
- Is the GPU box up? Check the cloud provider console.
- Did the model get OOM'd? Check the GPU box's logs for OOM kills.

**Restart playbook:**
- Ollama (dev): `ollama serve` (in a fresh terminal). The model auto-loads on first request.
- vLLM (prod): `pkill -f vllm; vllm serve Qwen/Qwen2.5-32B-Instruct --quantization awq --max-model-len 8192 --gpu-memory-utilization 0.9 --port 8000` (replace with your full command from `infra/`).

**While the LLM is down:**
- The app keeps working in deterministic-parser mode. § 18 explicitly accepts this. Don't take the app down to "fix" it.

---

## API costs spike

The most expensive thing in the system is ElevenLabs streaming. Cost guardrails (§ 11):

1. **Pre-generated phrases should cover >90% of TTS calls in a normal session.** If they don't, something's wrong:
   - The cache key is unstable (settings drift?).
   - New phrases were added without re-running `npm run generate:phrases`.
   - A feature is calling `/api/tts` with dynamic text it shouldn't.
2. The 200-char cap on `/api/tts` is enforced server-side. Check that the `text` query param's length stays under it.
3. ElevenLabs has a monthly budget alarm — set it to ~50% of expected spend so you get a warning before hitting limits.

**Investigate:**
- `server/cache/tts/` directory — count files. A normal demo session should produce zero new files (everything cached). New files == new dynamic phrases.
- The `performance-auditor` subagent runs the cache-hit-rate measurement at every milestone — re-run it locally (`npm run audit` once we have it) to confirm.

---

## Rotating an API key

**ElevenLabs:**
1. Generate a new key in the ElevenLabs dashboard.
2. Update `.env` on the server: `ELEVENLABS_API_KEY=<new>`.
3. Restart the server (or send `SIGHUP` if we wire reload).
4. Invalidate the old key in the dashboard.

**OpenAI (Whisper):**
Same as above with `OPENAI_API_KEY`.

**Local LLM (Ollama / vLLM):**
The `LLM_API_KEY` is a placeholder for local servers (Ollama accepts any value). No real key to rotate. For hosted alternatives (Fireworks / Together / OpenRouter), follow their UI flow.

**Never:**
- Commit a key. The `.gitignore` excludes `.env`.
- Log a key. The proxies drain upstream error bodies but never log them.
- Echo a key in error responses. Errors return `{ error: 'tts_disabled' }`-style codes — never the underlying message.

---

## Rotating the session secret

`SESSION_SECRET` signs the session cookie. Rotating it invalidates every existing session — all users will be auto-logged-out and need to re-onboard.

1. Generate a new value: `openssl rand -hex 32`.
2. Update `.env`: `SESSION_SECRET=<new>`.
3. Restart the server.

There is no graceful key-rotation period; existing cookies will fail the HMAC check on next request and the user gets routed back to onboarding.

If you want graceful rotation, a future change would store the previous secret as `SESSION_SECRET_PREV` and `verifySession` would try both. Not implemented as of v1.

---

## Rolling back a bad deploy

`main` is sacred (§ 5) — every change went through PR + audits. If the demo breaks anyway:

1. Find the last green commit on `main` (`git log --oneline`).
2. Revert the bad commit:
   ```
   git revert <bad-sha>
   git push origin main
   ```
3. CI runs again. Once green, redeploy.
4. File a follow-up issue describing what broke and link to the revert.

**Never:**
- `git push --force` to `main`.
- Skip the audit subagents to ship a revert faster.

---

## Clearing caches

| Cache | Path | When to clear |
|---|---|---|
| TTS bytes | `server/cache/tts/` (resolved from `TTS_CACHE_DIR`) | Voice/settings change → cache key invalidates anyway, but stale shards waste disk. `rm -rf cache/tts/*`. |
| Audio uploads | `server/uploads/audio/` | Only when intentionally wiping demo state. **Never** in prod — these are user content. |
| Pre-generated phrase MP3s | `client/public/audio/phrases/` | Voice change → re-run `npm run generate:phrases --force`. The new MP3s commit alongside the change. |
| SQLite WAL files | `*.db-shm`, `*.db-wal` | Auto-managed by SQLite. Only delete if the DB is corrupt and you have a backup. |
| Browser caches (during dev) | Hard-refresh: Ctrl+Shift+R / Cmd+Shift+R |

---

## Common API error codes

| Code | Where | Meaning | What to do |
|---|---|---|---|
| `403 Forbidden` (rare) | any | Rate limit hit | Wait 60s. The default is 60/min/IP. |
| `401 no_session` | `/api/auth/me` | No or invalid session cookie | Re-onboard the user. |
| `400 invalid_query` | `/api/memos` | Bad `cursor` or `limit` | Client bug — check the cursor format. |
| `400 invalid_cursor` | `/api/memos` | Cursor was tampered with | Client bug. |
| `400 invalid_text` | `/api/tts` | Empty or >200-char text | Client bug — every spoken phrase must fit. |
| `400 invalid_voice` | `/api/tts` | Voice ID not allow-listed | Add to `ELEVENLABS_ALLOWED_VOICES`. |
| `400 invalid_request` | `/api/llm` | Missing or oversize transcript | Client bug — check `handleTranscript`. |
| `415 unsupported_mime_type` | `/api/memos`, `/api/stt`, `/api/auth/signup`, `/api/memos/:id/comments` | MediaRecorder produced a non-allow-listed mime | Browser-specific. Update `ALLOWED_MIME_TYPES` in `audio-store.ts`. |
| `413 audio_too_large` | same as above | >5 MB upload | Check the recorder's 2-minute cap is firing. |
| `502 tts_upstream` | `/api/tts` | ElevenLabs returned an error | Check ElevenLabs status. App falls through to Web Speech. |
| `502 llm_upstream` | `/api/llm` | LLM returned an error | Check the GPU box. App falls through to deterministic parser. |
| `502 llm_dispatch_failed` | `/api/llm` | LLM hallucinated a memo id, or schema mismatch | Inspect logs for `code: memo_not_found` etc. App falls through. |
| `502 stt_upstream` | `/api/stt` | Whisper returned an error | Check OpenAI status. App falls through to deterministic parser. |
| `503 tts_disabled` | `/api/tts` | `ELEVENLABS_API_KEY` unset | Expected in local-only mode. |
| `503 llm_disabled` | `/api/llm` | `LLM_BASE_URL` unset | Expected when no LLM box is configured. |
| `503 stt_disabled` | `/api/stt` | `OPENAI_API_KEY` unset | Expected in local-only mode. |
| `504 llm_timeout` | `/api/llm` | LLM exceeded 2s | Check GPU load. App falls through. |
| `404 memo_not_found` | `/api/memos/:id/...` | Memo doesn't exist | Usually benign — race with a cascade delete. |
| `404 audio_missing` | `/api/memos/:id/audio` | DB row exists but file is gone | Disk corruption or manual deletion. Restore from backup. |

---

## Disk + DB hygiene

**SQLite database** lives at `data/third-eye.db` (resolved from `DB_FILE`). It includes WAL sidecar files (`.db-shm`, `.db-wal`).

- Backup: `cp data/third-eye.db backups/third-eye-$(date +%F).db`. Do this before any schema change.
- Restore: `cp backups/third-eye-2026-04-28.db data/third-eye.db`. Restart the server.
- Vacuum (rare): `sqlite3 data/third-eye.db "VACUUM;"`. Reclaims space after large deletes.

**Audio uploads** at `uploads/audio/` (resolved from `AUDIO_UPLOAD_DIR`) — user-owned content, treat like the DB. Back up alongside the DB.

**TTS cache** at `cache/tts/` is regeneratable from ElevenLabs — never back up, just rebuild.
