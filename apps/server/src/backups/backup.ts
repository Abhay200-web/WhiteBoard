import { cp, mkdir, readdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { hostSettings, type Db } from '@whiteboard/db';
import { eq } from 'drizzle-orm';

import { filesRoot } from '../files/storage';

export type BackupKind = 'daily' | 'manual' | 'pre-migration';

/** `manifest.json` inside every finished backup folder. */
export interface BackupManifest {
  name: string;
  kind: BackupKind;
  createdAt: number;
  serverVersion: string;
  /** Only set once every file is in place; folders without it are ignored. */
  complete: true;
}

export const DB_FILE = 'whiteboard.db';
const MANIFEST = 'manifest.json';
const BACKUP_DIR_SETTING = 'backupDir';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A daily backup is overdue after this long without any successful backup. */
export const STALE_AFTER_MS = 36 * HOUR;

export function getBackupDir(db: Db, dataDir: string): string {
  const row = db.select().from(hostSettings).where(eq(hostSettings.key, BACKUP_DIR_SETTING)).get();
  return typeof row?.value === 'string' && row.value ? row.value : path.join(dataDir, 'backups');
}

function stamp(date: Date): string {
  // 2026-11-13T09-30-00-123Z: sortable and valid in Windows folder names.
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Writes one backup: a consistent copy of the SQLite file (SQLite's online backup, safe while the
 * Host runs), a copy of the uploaded files, and a manifest. It is built in a `.partial` folder and
 * renamed at the end, so an interrupted backup is never mistaken for a good one.
 */
export async function createBackup(
  db: Db,
  dataDir: string,
  backupDir: string,
  opts: { kind: BackupKind; serverVersion: string; now?: Date },
): Promise<BackupManifest> {
  const now = opts.now ?? new Date();
  const name = `${stamp(now)}-${opts.kind}`;
  const partial = path.join(backupDir, `${name}.partial`);
  await mkdir(backupDir, { recursive: true });
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial);
  try {
    await db.$client.backup(path.join(partial, DB_FILE));
    // `tmp` holds half-uploaded files; they are not part of any backup.
    await cp(filesRoot(dataDir), path.join(partial, 'files'), {
      recursive: true,
      filter: (src) => path.relative(filesRoot(dataDir), src) !== 'tmp',
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err; // no uploads yet
    });
    const manifest: BackupManifest = {
      name,
      kind: opts.kind,
      createdAt: now.getTime(),
      serverVersion: opts.serverVersion,
      complete: true,
    };
    await mkdir(path.join(partial, 'files'), { recursive: true });
    await writeFile(path.join(partial, MANIFEST), JSON.stringify(manifest, null, 2));
    await rename(partial, path.join(backupDir, name));
    return manifest;
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
}

/** Finished backups, newest first. Partial or unreadable folders are ignored. */
export async function listBackups(backupDir: string): Promise<BackupManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(backupDir);
  } catch {
    return [];
  }
  const out: BackupManifest[] = [];
  for (const entry of entries) {
    if (entry.endsWith('.partial')) continue;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(backupDir, entry, MANIFEST), 'utf8'),
      ) as BackupManifest;
      if (manifest.complete === true && manifest.name === entry) out.push(manifest);
    } catch {
      // not one of ours
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** ISO week key like `2026-W46` (weeks start on Monday, UTC). */
function weekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3),
  );
  const week1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - week1.getTime()) / DAY - 3 + ((week1.getUTCDay() + 6) % 7)) / 7,
    );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const KEEP_DAILY = 7;
export const KEEP_WEEKLY = 4;
const KEEP_PRE_MIGRATION_MS = 30 * DAY;

/** Which backups the retention policy keeps. Pure, so it is easy to test. */
export function selectBackupsToKeep(backups: readonly BackupManifest[], now: Date): Set<string> {
  const keep = new Set<string>();
  const newestFirst = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  // The newest backup is never deleted, whatever its age.
  if (newestFirst[0]) keep.add(newestFirst[0].name);

  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const b of newestFirst) {
    // Safety copies taken before an update stay for a month.
    if (b.kind === 'pre-migration' && now.getTime() - b.createdAt < KEEP_PRE_MIGRATION_MS) {
      keep.add(b.name);
    }
    const day = new Date(b.createdAt).toISOString().slice(0, 10);
    if (days.size < KEEP_DAILY && !days.has(day)) {
      days.add(day);
      keep.add(b.name);
      continue;
    }
    const week = weekKey(b.createdAt);
    // Weekly keepers are the newest backup of each week older than the daily window.
    if (!days.has(day) && weeks.size < KEEP_WEEKLY && !weeks.has(week)) {
      weeks.add(week);
      keep.add(b.name);
    }
  }
  return keep;
}

/** Deletes backups the policy no longer keeps. Returns the deleted names. */
export async function pruneBackups(backupDir: string, now = new Date()): Promise<string[]> {
  const backups = await listBackups(backupDir);
  const keep = selectBackupsToKeep(backups, now);
  const removed: string[] = [];
  for (const b of backups) {
    if (keep.has(b.name)) continue;
    await rm(path.join(backupDir, b.name), { recursive: true, force: true });
    removed.push(b.name);
  }
  return removed;
}

export interface BackupStatus {
  backupDir: string;
  lastBackupAt: number | null;
  /** True when there is no backup yet, or the last one is older than 36 hours. */
  stale: boolean;
  /** Free space on the drive holding the backup folder (`null` if it cannot be read). */
  freeBytes: number | null;
  backups: BackupManifest[];
}

export async function getBackupStatus(
  db: Db,
  dataDir: string,
  now = new Date(),
): Promise<BackupStatus> {
  const backupDir = getBackupDir(db, dataDir);
  const backups = await listBackups(backupDir);
  const lastBackupAt = backups[0]?.createdAt ?? null;
  let freeBytes: number | null = null;
  try {
    await mkdir(backupDir, { recursive: true });
    const fs = await statfs(backupDir);
    freeBytes = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    // unreadable drive: the UI shows "unknown"
  }
  return {
    backupDir,
    lastBackupAt,
    stale: lastBackupAt === null || now.getTime() - lastBackupAt > STALE_AFTER_MS,
    freeBytes,
    backups,
  };
}
