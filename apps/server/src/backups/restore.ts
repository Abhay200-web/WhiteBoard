import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DB_FILE, type BackupManifest } from './backup';

export class RestoreError extends Error {}

/**
 * Restores a backup folder into `dataDir`. The Host must be stopped (nothing may have the
 * database open). If `dataDir` already holds data it is refused unless `replace` is set, in which
 * case the current database and files are moved to `restore-previous-<time>` instead of deleted.
 * Returns where the old data went (or `null`).
 */
export async function restoreBackup(
  backupPath: string,
  dataDir: string,
  { replace = false, now = new Date() }: { replace?: boolean; now?: Date } = {},
): Promise<string | null> {
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(backupPath, 'manifest.json'), 'utf8'));
  } catch {
    throw new RestoreError(`${backupPath} is not a finished backup (no manifest.json)`);
  }
  if (manifest.complete !== true) throw new RestoreError('This backup is incomplete');

  const sourceDb = path.join(backupPath, DB_FILE);
  if (!existsSync(sourceDb)) throw new RestoreError('The backup has no database file');
  // Check the backup is readable before touching the live data.
  const probe = new Database(sourceDb, { readonly: true });
  try {
    const result = probe.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new RestoreError(`The backup database is damaged: ${result}`);
  } finally {
    probe.close();
  }

  await mkdir(dataDir, { recursive: true });
  const liveDb = path.join(dataDir, DB_FILE);
  const liveFiles = path.join(dataDir, 'files');
  let movedTo: string | null = null;
  if (existsSync(liveDb) || existsSync(liveFiles)) {
    if (!replace) {
      throw new RestoreError(
        `${dataDir} already has data. Restore into an empty folder, or pass --replace to keep the old data in restore-previous-*`,
      );
    }
    movedTo = path.join(dataDir, `restore-previous-${now.toISOString().replace(/[:.]/g, '-')}`);
    await mkdir(movedTo);
    for (const name of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, 'files']) {
      const from = path.join(dataDir, name);
      if (existsSync(from)) await rename(from, path.join(movedTo, name));
    }
  }

  try {
    await cp(sourceDb, liveDb);
    await cp(path.join(backupPath, 'files'), liveFiles, { recursive: true });
  } catch (err) {
    // Leave the Host as it was rather than half-restored.
    await rm(liveDb, { force: true });
    await rm(liveFiles, { recursive: true, force: true });
    if (movedTo) {
      for (const name of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, 'files']) {
        const from = path.join(movedTo, name);
        if (existsSync(from)) await rename(from, path.join(dataDir, name));
      }
    }
    throw err;
  }
  return movedTo;
}
