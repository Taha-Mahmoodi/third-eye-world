import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  dispatchLlmResponse,
  DispatchError,
} from '../src/llm/dispatcher.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { DEMO_USER_ID } from '../src/lib/demo-user.js';
import { ensureDemoUser } from '../src/lib/demo-user.js';

function seedMemo(db: DB, id: string): void {
  db.prepare(
    `INSERT INTO memos (id, user_id, audio_path, mime_type, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, DEMO_USER_ID, `${id}.webm`, 'audio/webm', null, Date.now());
}

describe('dispatchLlmResponse', () => {
  let db: DB;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    ensureDemoUser(db);
  });

  afterEach(() => {
    db.close();
  });

  it('extracts speak_text from the speak tool', () => {
    const result = dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'speak', arguments: { phrase: 'Hello.' } },
        ],
      },
      { db },
    );
    expect(result.speak_text).toBe('Hello.');
    expect(result.client_actions).toEqual([]);
    expect(result.executed).toEqual([]);
  });

  it('throws DispatchError(no_speak) when there is no speak tool', () => {
    expect(() =>
      dispatchLlmResponse(
        { tool_calls: [{ name: 'next_memo', arguments: {} }] },
        { db },
      ),
    ).toThrow(DispatchError);
  });

  it('throws DispatchError(multiple_speak) when there are two speak tools', () => {
    expect(() =>
      dispatchLlmResponse(
        {
          tool_calls: [
            { name: 'speak', arguments: { phrase: 'A.' } },
            { name: 'speak', arguments: { phrase: 'B.' } },
          ],
        },
        { db },
      ),
    ).toThrow(/multiple_speak|more than one speak/);
  });

  it('executes like_memo against the DB and excludes it from client_actions', () => {
    seedMemo(db, 'm-1');

    const result = dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'like_memo', arguments: { memo_id: 'm-1' } },
          { name: 'speak', arguments: { phrase: 'Liked.' } },
        ],
      },
      { db },
    );

    const count = db
      .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM likes')
      .get([]);
    expect(count?.count).toBe(1);
    expect(result.executed.map((c) => c.name)).toEqual(['like_memo']);
    expect(result.client_actions).toEqual([]);
  });

  it('executes unlike_memo against the DB', () => {
    seedMemo(db, 'm-1');
    db.prepare(
      `INSERT INTO likes (user_id, memo_id, created_at) VALUES (?, ?, ?)`,
    ).run(DEMO_USER_ID, 'm-1', 100);

    dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'unlike_memo', arguments: { memo_id: 'm-1' } },
          { name: 'speak', arguments: { phrase: 'Unliked.' } },
        ],
      },
      { db },
    );

    const count = db
      .prepare<unknown[], { count: number }>('SELECT COUNT(*) AS count FROM likes')
      .get([]);
    expect(count?.count).toBe(0);
  });

  it('throws DispatchError(memo_not_found) for a hallucinated memo id', () => {
    expect(() =>
      dispatchLlmResponse(
        {
          tool_calls: [
            { name: 'like_memo', arguments: { memo_id: 'totally-made-up' } },
            { name: 'speak', arguments: { phrase: 'Liked.' } },
          ],
        },
        { db },
      ),
    ).toThrow(/memo_not_found|memo not found/);
  });

  it('validates memo_id existence even for client-side tools (start_comment)', () => {
    expect(() =>
      dispatchLlmResponse(
        {
          tool_calls: [
            { name: 'start_comment', arguments: { memo_id: 'made-up' } },
            { name: 'speak', arguments: { phrase: 'Go ahead.' } },
          ],
        },
        { db },
      ),
    ).toThrow(/memo_not_found|memo not found/);
  });

  it('returns client_actions for browser-side tools (next_memo, pause)', () => {
    const result = dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'next_memo', arguments: {} },
          { name: 'speak', arguments: { phrase: 'Next.' } },
        ],
      },
      { db },
    );
    expect(result.client_actions.map((c) => c.name)).toEqual(['next_memo']);
  });

  it('returns multiple client actions when the LLM batches them', () => {
    const result = dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'pause', arguments: {} },
          { name: 'speak_help', arguments: {} },
          { name: 'speak', arguments: { phrase: 'Paused.' } },
        ],
      },
      { db },
    );
    expect(result.client_actions.map((c) => c.name)).toEqual([
      'pause',
      'speak_help',
    ]);
  });

  it('mixes server execution + client actions correctly', () => {
    seedMemo(db, 'm-1');

    const result = dispatchLlmResponse(
      {
        tool_calls: [
          { name: 'like_memo', arguments: { memo_id: 'm-1' } },
          { name: 'next_memo', arguments: {} },
          { name: 'speak', arguments: { phrase: 'Liked. Next memo.' } },
        ],
      },
      { db },
    );
    expect(result.executed.map((c) => c.name)).toEqual(['like_memo']);
    expect(result.client_actions.map((c) => c.name)).toEqual(['next_memo']);
    expect(result.speak_text).toBe('Liked. Next memo.');
  });
});
