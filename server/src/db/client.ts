import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const SCHEMA_FILE = 'schema.sql';

export interface OpenOptions {
  /** Path to the SQLite file. Use ":memory:" for tests. */
  filename: string;
  /** Whether to apply schema.sql on open. Defaults to true. */
  applySchema?: boolean;
}

export function openDatabase(options: OpenOptions): DB {
  const db = new Database(options.filename);

  // Enforce foreign keys — SQLite has them off by default.
  db.pragma('foreign_keys = ON');

  // WAL gives concurrent readers + a single writer with much better
  // throughput than the default rollback journal. Safe for the demo's
  // single-process Fastify server.
  if (options.filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  if (options.applySchema !== false) {
    applySchema(db);
  }

  return db;
}

export function applySchema(db: DB): void {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), SCHEMA_FILE);
  const sql = readFileSync(schemaPath, 'utf-8');
  db.exec(sql);
}
