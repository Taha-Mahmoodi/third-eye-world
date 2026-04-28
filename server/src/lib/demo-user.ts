// Demo user bootstrap.
//
// Phase 1 needs a stable user_id for memos but does not yet have an auth
// flow (that arrives in Phase 6: feature/voice-onboarding). Rather than make
// memos.user_id nullable just for the demo, we ensure a single hardcoded
// "demo" user exists at startup and route every memo to them.
//
// This module disappears in Phase 6 — the onboarding flow creates real users
// from spoken names and the route swaps to req.session.userId.

import type { DB } from '../db/client.js';

export const DEMO_USER_ID = 'demo';
export const DEMO_USER_NAME = 'Demo';

export function ensureDemoUser(db: DB): void {
  db.prepare(
    `INSERT INTO users (id, name, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(DEMO_USER_ID, DEMO_USER_NAME, Date.now());
}
