# Third Eye World

A voice-first audio social network. The blind user is the default user, not an accommodation.

The full build contract lives in [INSTRUCTIONS.md](INSTRUCTIONS.md). Read it before changing code.

## Quick start

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY, ELEVENLABS_API_KEY, SESSION_SECRET
npm run dev
```

That's it. The dev server boots both client (Vite) and server (Fastify) and the app is reachable at `http://localhost:3000`.

## What you can do today

This README is updated phase-by-phase. See `INSTRUCTIONS.md` § 9 for the phased plan.

- [x] Phase 0 — repo bootstrap
- [ ] Phase 1 — record + play loop
- [ ] Phase 2 — voice commands + keyboard equivalents
- [ ] Phase 3 — ElevenLabs integration
- [ ] Phase 4 — comments + likes
- [ ] Phase 5 — local LLM (Qwen 2.5 32B)
- [ ] Phase 6 — voice onboarding
- [ ] Phase 7 — polish, hardening, demo video

## When something breaks

See `docs/runbook.md` (added in Phase 7). Until then, check `INSTRUCTIONS.md` § 18.

## License

MIT — see `LICENSE`.
