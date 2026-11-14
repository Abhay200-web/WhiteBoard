// Drizzle schema (SQLite) and migrations
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

export * from './schema';

/** Drizzle handle; `$client` is the raw better-sqlite3 connection (used for online backups). */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** The handle inside `db.transaction((tx) => ...)`. */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Opens the Host database. Only the Host server process may open this file. */
export function openDatabase(file: string): { db: Db; close: () => void } {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

/**
 * How many migrations would run next. `null` for a brand-new database (nothing to protect, so no
 * pre-migration backup is needed); otherwise the number of journal entries not yet applied.
 */
export function pendingMigrationCount(db: Db, migrationsFolder = MIGRATIONS_DIR): number | null {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const table = db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!table) return null;
  const { applied } = db.$client
    .prepare('SELECT COUNT(*) AS applied FROM __drizzle_migrations')
    .get() as {
    applied: number;
  };
  return Math.max(journal.entries.length - applied, 0);
}

export function migrateDatabase(db: Db, migrationsFolder = MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
