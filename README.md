# Third Eye World

A voice-first audio social network. The blind user is the default user, not an accommodation.

The full build contract lives in [INSTRUCTIONS.md](INSTRUCTIONS.md). Read it before changing code.

## Quick start (local-only — no API keys needed)

```bash
npm install
cp .env.example .env
npm run dev:server   # shell 1 — Fastify on :3000
npm run dev:client   # shell 2 — Vite on :5173 → open this in your browser
```

The app is reachable at `http://localhost:5173`. Spoken feedback uses the browser's built-in Web Speech API (`SpeechSynthesis`) — no ElevenLabs key required.

## Going beyond local-only (ElevenLabs voice)

The client's `speak()` function has a four-link fallback chain (pre-baked MP3 → server proxy → ElevenLabs streaming → Web Speech). The first three links are **disabled by default** so the app works offline / keyless. To enable the warm AI voice:

1. Get an ElevenLabs API key.
2. Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`.
3. Open `http://localhost:5173/_internal/voices/`, listen with a blind tester, pick a voice. (Per INSTRUCTIONS.md § 9 Phase 3 audit.)
4. `npm run generate:phrases` — bakes the v1 phrases as MP3s under `client/public/audio/phrases/` (committed to repo).
5. In `client/src/voice/speak.ts`, flip `ELEVENLABS_ENABLED` from `false` to `true`.

The ElevenLabs path code is preserved in place; the constant is the only switch.

## What you can do today

This README is updated phase-by-phase. See `INSTRUCTIONS.md` § 9 for the phased plan.

- [x] Phase 0 — repo bootstrap
- [x] Phase 1 — record + play loop
- [x] Phase 2 — voice commands + keyboard equivalents
- [x] Phase 3 — ElevenLabs integration *(code merged; running in local-only mode pending the voice-quality audit and a baked phrase set)*
- [x] Phase 4 — comments + likes
- [x] Phase 5 — local LLM (Qwen 2.5 32B) *(scaffolded; activates when `LLM_BASE_URL` is set and Ollama / vLLM is running)*
- [x] Phase 6 — voice onboarding *(server-side auth + signed cookies done; client-side wrapper is a v1.1 follow-up)*
- [x] Phase 7 — polish, hardening, demo video *(runbook done; a11y full-pass + load test + demo video are human tasks tracked in the milestone audit)*

## When something breaks

See [`docs/runbook.md`](docs/runbook.md) — common API error codes, "the LLM box died" playbook, key + secret rotation, cache clearing, deploy rollback. The owner is non-technical; the runbook answers each question in plain English.

## License

MIT — see `LICENSE`.
