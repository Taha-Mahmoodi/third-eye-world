// Session — signed cookie holding the user id.
//
// Phase 6 task 1 per INSTRUCTIONS.md § 9 + § 13 hard rules.
//
// Cookies are HMAC-SHA-256 signed with SESSION_SECRET so a tampered
// cookie is rejected. HttpOnly + SameSite=Lax always; Secure when
// NODE_ENV === 'production' (browsers reject Secure cookies on http
// in dev).
//
// Forward compat: this module replaces the demo-user fallback (PR #14)
// once a session cookie is present. Routes that still call
// DEMO_USER_ID directly continue to work unchanged — the migration is
// gradual.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export const SESSION_COOKIE_NAME = 'tew.sid';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface Session {
  userId: string;
}

/** Sign a userId with the secret. Returns "<userId>.<sig>". */
export function signSession(userId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(userId).digest('base64url');
  return `${userId}.${sig}`;
}

/** Verify a signed cookie value. Returns the userId or null. */
export function verifySession(cookieValue: string, secret: string): string | null {
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return null;
  const userId = cookieValue.slice(0, dot);
  const provided = cookieValue.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(userId).digest('base64url');
  // Timing-safe compare. Length mismatch means invalid signature.
  const a = Buffer.from(provided, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return userId;
}

export interface SessionOptions {
  secret: string;
  /** Defaults to NODE_ENV === 'production'. */
  secure?: boolean;
}

export function readSession(
  request: FastifyRequest,
  options: SessionOptions,
): Session | null {
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const raw = cookies?.[SESSION_COOKIE_NAME];
  if (!raw) return null;
  const userId = verifySession(raw, options.secret);
  if (!userId) return null;
  return { userId };
}

export function writeSession(
  reply: FastifyReply,
  userId: string,
  options: SessionOptions,
): void {
  const value = signSession(userId, options.secret);
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  void reply.setCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSession(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}
