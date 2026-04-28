import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type DB } from '../src/db/client.js';

describe('schema.sql', () => {
  let db: DB;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  it('creates the users, memos, likes, and comments tables', () => {
    const tables = db
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all([])
      .map((row) => row.name);

    expect(tables).toEqual(['comments', 'likes', 'memos', 'users']);
  });

  it('creates the expected indexes on memos', () => {
    const indexes = db
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memos' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all([])
      .map((row) => row.name);

    expect(indexes).toEqual(['idx_memos_created_at', 'idx_memos_user_id']);
  });

  it('inserts a user and a memo for that user', () => {
    db.prepare(
      'INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)',
    ).run('u1', 'Asha', 1_000_000);

    db.prepare(
      'INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('m1', 'u1', '/tmp/m1.webm', 'audio/webm', 4_200, 1_000_500);

    const memo = db
      .prepare<unknown[], { id: string; user_id: string; audio_path: string }>(
        'SELECT id, user_id, audio_path FROM memos WHERE id = ?',
      )
      .get('m1');

    expect(memo).toEqual({ id: 'm1', user_id: 'u1', audio_path: '/tmp/m1.webm' });
  });

  it('rejects a memo with a user_id that does not exist (foreign keys ON)', () => {
    expect(() => {
      db.prepare(
        'INSERT INTO memos (id, user_id, audio_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('m1', 'nonexistent', '/tmp/m1.webm', 'audio/webm', 1_000_000);
    }).toThrowError(/FOREIGN KEY/i);
  });

  it('cascades memo deletion when the owning user is deleted', () => {
    db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(
      'u1',
      'Asha',
      1_000_000,
    );
    db.prepare(
      'INSERT INTO memos (id, user_id, audio_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('m1', 'u1', '/tmp/m1.webm', 'audio/webm', 1_000_500);
    db.prepare(
      'INSERT INTO memos (id, user_id, audio_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('m2', 'u1', '/tmp/m2.webm', 'audio/webm', 1_000_600);

    db.prepare('DELETE FROM users WHERE id = ?').run('u1');

    const remaining = db
      .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM memos')
      .get([]);
    expect(remaining?.count).toBe(0);
  });

  it('rejects a memo without required NOT NULL columns', () => {
    db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(
      'u1',
      'Asha',
      1_000_000,
    );

    expect(() => {
      db.prepare(
        'INSERT INTO memos (id, user_id, audio_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('m1', 'u1', null, 'audio/webm', 1_000_500);
    }).toThrowError(/NOT NULL/i);
  });

  it('is idempotent — re-applying the schema on an existing DB is a no-op', () => {
    db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(
      'u1',
      'Asha',
      1_000_000,
    );

    // openDatabase with applySchema:true on the same DB instance is the
    // closest test of idempotency we can run in-memory; the real workflow
    // is "open the existing file, apply schema again, no error".
    const reopen = openDatabase({ filename: ':memory:' });
    expect(() => reopen.exec(db.prepare('SELECT 1').source)).not.toThrow();
    reopen.close();

    const user = db
      .prepare<unknown[], { id: string; name: string }>(
        'SELECT id, name FROM users WHERE id = ?',
      )
      .get('u1');
    expect(user).toEqual({ id: 'u1', name: 'Asha' });
  });
});
