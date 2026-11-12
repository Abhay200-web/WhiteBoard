// Drizzle schema (SQLite) and migrations
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

export * from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Opens the Host database. Only the Host server process may open this file. */
export function openDatabase(file: string): { db: Db; close: () => void } {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

export function migrateDatabase(db: Db, migrationsFolder = MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
