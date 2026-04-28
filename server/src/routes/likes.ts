// Likes — Phase 4 task 1 per INSTRUCTIONS.md § 9.
//
// POST   /api/memos/:id/like   → { liked: true,  count }
// DELETE /api/memos/:id/like   → { liked: false, count }
//
// user_id is the Phase-1 demo user; Phase 6 swaps for req.session.userId.
//
// Hard rules honored:
// - § 13: parameterized SQL (no string concatenation).
// - § 13: rate-limited (registered globally in index.ts).
// - § 16 Audio files immutable: not relevant here, but the like row's
//   memo_id is only valid for an existing memo — FK enforces.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { DB } from '../db/client.js';
import { DEMO_USER_ID } from '../lib/demo-user.js';

export interface LikesRoutesOptions {
  db: DB;
}

interface CountRow {
  count: number;
}

export const likesRoutes = (options: LikesRoutesOptions): FastifyPluginAsync =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function likesRoutesPlugin(app: FastifyInstance) {
    const insertLike = options.db.prepare(
      `INSERT INTO likes (user_id, memo_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, memo_id) DO NOTHING`,
    );
    const deleteLike = options.db.prepare(
      `DELETE FROM likes WHERE user_id = ? AND memo_id = ?`,
    );
    const countLikes = options.db.prepare<[string], CountRow>(
      `SELECT COUNT(*) AS count FROM likes WHERE memo_id = ?`,
    );
    const memoExists = options.db.prepare<[string], { id: string }>(
      `SELECT id FROM memos WHERE id = ?`,
    );

    app.post<{ Params: { id: string } }>(
      '/api/memos/:id/like',
      // eslint-disable-next-line @typescript-eslint/require-await
      async (request, reply) => {
        const memoId = request.params.id;
        if (!memoExists.get(memoId)) {
          return reply.code(404).send({
            error: 'memo_not_found',
            message: 'No memo with that id.',
          });
        }
        insertLike.run(DEMO_USER_ID, memoId, Date.now());
        const row = countLikes.get(memoId);
        return reply.send({ liked: true, count: row?.count ?? 0 });
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/memos/:id/like',
      // eslint-disable-next-line @typescript-eslint/require-await
      async (request, reply) => {
        const memoId = request.params.id;
        if (!memoExists.get(memoId)) {
          return reply.code(404).send({
            error: 'memo_not_found',
            message: 'No memo with that id.',
          });
        }
        deleteLike.run(DEMO_USER_ID, memoId);
        const row = countLikes.get(memoId);
        return reply.send({ liked: false, count: row?.count ?? 0 });
      },
    );
  };
