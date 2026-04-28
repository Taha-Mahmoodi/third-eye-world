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

**Skeleton.** Populated in Phase 3 (`feature/elevenlabs-skill`, INSTRUCTIONS.md § 9). The contract below is the spec — implementation lands then.

## The two tiers (INSTRUCTIONS.md § 11)

**Pre-generated MP3s** for fixed phrases (≈ 16 of them — every entry in `client/src/strings.ts` that has no variable). Generated once at build via `scripts/generate-phrases.ts`. Written to `client/public/audio/phrases/<key>.mp3` and committed to the repo. The client tries these first.

**Streamed dynamic** for phrases with variables ("Memo from Asha, posted two minutes ago"). Server-side cached by phrase hash so the same phrase is not re-generated.

## Voice settings (defaults — finalize after voice testing in Phase 3)

```
stability: 0.5
similarity_boost: 0.75
model:
  - eleven_turbo_v2_5    # for streaming dynamic phrases (low latency)
  - eleven_multilingual_v2  # for pre-baked phrases (best quality)
```

Voice ID is picked via the `/_internal/voices` test page in Phase 3 with at least one blind tester. The chosen ID lives in `ELEVENLABS_VOICE_ID` (`.env`).

## Server proxy contract (`/api/tts`)

```
GET /api/tts?text=<text>&voice=<voiceId>
```

- Holds the API key. The browser must never see it (§ 2 #9).
- Streams audio chunks back as `audio/mpeg`.
- Caches by `sha256(text + voiceId + JSON.stringify(settings))` on disk under `server/cache/tts/`. TTL: never expire (audio for the same input is deterministic enough).
- Rate-limited per session (§ 13).
- Input length capped at 200 chars (§ 11) — phrases longer than that are a sign something is wrong upstream.
- 4xx error if `text` is empty, longer than 200 chars, or `voice` is not in the allowed list.

## Cache key format

```
key = sha256(text + "|" + voiceId + "|" + settingsJson)
path = server/cache/tts/<first-2-of-key>/<key>.mp3
```

First-2-of-key sharding keeps the cache directory from holding hundreds of files at one level.

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
