-- Third Eye World v1 schema.
--
-- Demo target uses SQLite via better-sqlite3 (INSTRUCTIONS.md § 3).
-- Production target is Postgres; the SQL here is intentionally
-- portable: only standard column types and FK syntax. PRAGMA lines
-- are SQLite-specific and applied separately by the client.
--
-- Phase 1 task 2 per § 9. Just users + memos. Likes and comments arrive
-- in Phase 4.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL  -- unix epoch ms
);

CREATE TABLE IF NOT EXISTS memos (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  audio_path   TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL,  -- unix epoch ms
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The feed query is "newest first" (Phase 1 task 4: GET /api/memos),
-- so an index on created_at DESC is the only one we need at this stage.
CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at DESC);

-- For "memos by user X" lookups (likes/comments will join on user_id).
CREATE INDEX IF NOT EXISTS idx_memos_user_id ON memos(user_id);

-- Phase 4: likes. Composite primary key (user_id, memo_id) makes a "liked"
-- relationship unique-by-design — no application-level UNIQUE check needed.
CREATE TABLE IF NOT EXISTS likes (
  user_id    TEXT NOT NULL,
  memo_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, memo_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
);

-- Counts the likes on a single memo: SELECT COUNT(*) FROM likes WHERE memo_id = ?
CREATE INDEX IF NOT EXISTS idx_likes_memo_id ON likes(memo_id);

-- Phase 4: comments. A comment is essentially a memo attached to a parent
-- memo (same audio + mime + duration shape) with a memo_id FK.
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  memo_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  audio_path   TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- "Comments on memo X, oldest-first" is the playback order — replies are
-- read out in the order they were posted.
CREATE INDEX IF NOT EXISTS idx_comments_memo_created
  ON comments(memo_id, created_at);
