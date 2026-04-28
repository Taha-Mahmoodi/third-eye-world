---
name: elevenlabs-integration
description: How the server proxies ElevenLabs, how phrases are pre-generated, the cache key contract, the fallback chain, and the cost guardrails. Used by the TTS proxy implementation and by the voice-ux-specialist + security-auditor + performance-auditor subagents.
---

# ElevenLabs integration

This skill is the source of truth for how Third Eye World talks to ElevenLabs. It is referenced by:
- `server/src/routes/tts.ts` — the proxy implementation
- `scripts/generate-phrases.ts` — the build-time phrase pre-generator
- `client/src/voice/` — the four-link fallback chain
- `.claude/agents/voice-ux-specialist.md` — fallback-chain audit
- `.claude/agents/security-auditor.md` — keys-stay-on-server audit
- `.claude/agents/performance-auditor.md` — cache-hit-rate audit

## Status

**Active.** Promoted from skeleton in Phase 3. The contract below governs:
- `server/src/routes/tts.ts` (`feature/tts-proxy`)
- `scripts/generate-phrases.ts` (`feature/phrase-pregenerator`)
- `client/src/voice/speak.ts` four-link chain (`feature/client-tts-player`)
- `/_internal/voices` test page (`feature/voice-selection-test-page`)

Voice ID selection is the only step that requires a human (a blind tester picks one of the candidate voices via `/_internal/voices`, the chosen ID lands in `ELEVENLABS_VOICE_ID`).

## The two tiers (INSTRUCTIONS.md § 11)

**Pre-generated MP3s** for fixed phrases — every entry in `client/src/strings.ts` that has no variable. v1 set is 19 phrases (record/playback/likes/comments/control/help — see strings.ts). Generated once at build via `scripts/generate-phrases.ts`. Written to `client/public/audio/phrases/<KEY>.mp3` (snake-case from the StringKey) and committed to the repo. The client tries these first.

**Streamed dynamic** for phrases with variables ("Memo from Asha, posted two minutes ago"). These do not exist yet in v1; they arrive in Phase 4 (memo announcements) and Phase 5 (LLM replies). Server-side cached by phrase hash so the same phrase is not re-generated.

## Voice settings

```
stability:        0.5
similarity_boost: 0.75
style:            0
use_speaker_boost: true

models:
  - eleven_multilingual_v2   # pre-baked phrases — best quality, slightly slower
  - eleven_turbo_v2_5        # streaming dynamic phrases — low first-byte latency
```

Voice ID is picked via the `/_internal/voices` test page with at least one blind tester. The chosen ID lives in `ELEVENLABS_VOICE_ID` (`.env`). Default candidates the page surfaces: Rachel (`21m00Tcm4TlvDq8ikWAM`), Bella (`EXAVITQu4vr4xnSDxMaL`), Adam (`pNInz6obpgDQGcFmaJgB`), Antoni (`ErXwobaYiN019PkySvjV`).

## Server proxy contract (`/api/tts`)

```
GET /api/tts?text=<text>&voice=<voiceId>&model=<modelId>
```

- Holds `ELEVENLABS_API_KEY`. The browser must never see it (§ 2 #9).
- Streams audio chunks back as `audio/mpeg`.
- Caches by `sha256(text|voiceId|modelId|settingsJson)` on disk under `<TTS_CACHE_DIR>/<first-2-of-key>/<key>.mp3`. TTL: never expire (audio for the same input is deterministic enough).
- Rate-limited per session (§ 13). Default 60/min, configurable via `BuildOptions.rateLimitPerMinute`.
- Validation:
  - `text` required, 1–200 chars (§ 11). 4xx with `{ error: 'invalid_text' }` otherwise.
  - `voice` required, must match `ELEVENLABS_ALLOWED_VOICES` (comma-separated env var) or the default `ELEVENLABS_VOICE_ID`. Otherwise 4xx with `{ error: 'invalid_voice' }`.
  - `model` optional. If provided, must be one of `eleven_multilingual_v2` or `eleven_turbo_v2_5`. Defaults to `eleven_multilingual_v2`.
- Cache hit → 200 with the bytes streamed from disk.
- Cache miss → server calls ElevenLabs `POST /v1/text-to-speech/<voiceId>/stream` with the API key, pipes bytes to both the client and the on-disk cache file simultaneously.
- ElevenLabs error → server returns 502 with `{ error: 'tts_upstream' }`. The client falls back to Web Speech (link 4 of the chain) so the app stays audible.
- Missing API key → server returns 503 with `{ error: 'tts_disabled' }`. Same fallback.

## Environment variables

```
ELEVENLABS_API_KEY        required for any non-cached TTS
ELEVENLABS_VOICE_ID       default voice; required at runtime
ELEVENLABS_ALLOWED_VOICES optional comma-separated allow-list (defaults to just ELEVENLABS_VOICE_ID)
TTS_CACHE_DIR             defaults to ./cache/tts
```

## Cache key format

```
key = sha256(text + "|" + voiceId + "|" + modelId + "|" + settingsJson)
path = <TTS_CACHE_DIR>/<first-2-of-key>/<key>.mp3
```

First-2-of-key sharding keeps the cache directory from holding hundreds of files at one level. The `settingsJson` is the canonical JSON of `{ stability, similarity_boost, style, use_speaker_boost }` so a settings change invalidates the cache without us having to wipe the directory.

## Fallback chain (single `speak(key)` on the client)

The client never calls ElevenLabs directly from a feature module. One `speak(key)` function owns the chain:

1. **Pre-generated MP3** — `client/public/audio/phrases/<key>.mp3` if it exists. Plays from local fetch.
2. **Server cache** — `GET /api/tts?text=…` with the resolved phrase. Server serves from disk if cached.
3. **ElevenLabs streaming** — server forwards to ElevenLabs and streams chunks back. Server writes to cache as it streams.
4. **Web Speech API** — `SpeechSynthesisUtterance`. Last resort. Always available.

Every link must work with the others removed:
- Drop the API key → still hear pre-generated phrases and Web Speech fallback for dynamic ones.
- Clear pre-generated dir → still hear streamed phrases.
- Drop key + clear cache + clear pre-generated → still hear Web Speech.

The app is **never silent after a user action** (§ 2 #4).

## Cost guardrails

- Pre-gen ~50 phrases at build time. Pennies, paid once. No per-session cost for fixed phrases.
- 200-char cap on dynamic. Prevents an LLM going off-script from generating a whole essay.
- Aggressive server-side cache (every dynamic phrase served from disk after first hit).
- Monthly budget alarm on the ElevenLabs account.
- Pre-generated coverage target: > 90% of TTS calls in a normal session (`performance-auditor` flags below this).

## Hard rules
- API key never in client code or git history (§ 2 #9). The proxy is the only path.
- 200-char cap is enforced at the proxy, not just on the client.
- Every dynamic phrase passes through the same cache path. No bypass for "just this once."
- Voice ID is set via env, not hard-coded. Different envs (dev, staging, prod) can pick different voices.
- The fallback chain is a contract. Removing a link is a feature change and needs explicit approval — `voice-ux-specialist` will block.
