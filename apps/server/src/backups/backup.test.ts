import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  hostSettings,
  migrateDatabase,
  openDatabase,
  pendingMigrationCount,
  users,
} from '@whiteboard/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { backupJob } from '../jobs/backup';
import { runDueJobs } from '../scheduler';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';
import {
  createBackup,
  getBackupStatus,
  listBackups,
  pruneBackups,
  selectBackupsToKeep,
  type BackupManifest,
} from './backup';
import { RestoreError, restoreBackup } from './restore';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let host: TestHost;
let owner: { token: string; workspaceId: string };
let backupDir: string;
const extraDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-backup-'));
  extraDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
  backupDir = path.join(tempDir(), 'backups');
});
afterEach(async () => {
  await host.cleanup();
  for (const dir of extraDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function addUpload(name: string, content: Buffer): Promise<{ id: string }> {
  const boundary = '----wbtest';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await host.app.inject({
    method: 'POST',
    url: '/files',
    payload,
    headers: {
      ...bearer(owner.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const make = (kind: BackupManifest['kind'], now: Date, dir = backupDir) =>
  createBackup(host.db, host.dataDir, dir, { kind, serverVersion: 'test', now });

describe('createBackup', () => {
  it('copies the database and the uploaded files, and skips half-uploaded temp files', async () => {
    await addUpload('notes.txt', Buffer.from('hello backup'));
    await mkdir(path.join(host.dataDir, 'files', 'tmp'), { recursive: true });
    await writeFile(path.join(host.dataDir, 'files', 'tmp', 'half-done'), 'x');

    const manifest = await make('manual', new Date('2026-11-13T10:00:00Z'));
    const folder = path.join(backupDir, manifest.name);
    expect(manifest).toMatchObject({ kind: 'manual', complete: true, serverVersion: 'test' });

    const copy = openDatabase(path.join(folder, 'whiteboard.db'));
    expect(copy.db.select().from(users).all()).toHaveLength(1);
    copy.close();
    const copiedFiles = readdirSync(path.join(folder, 'files'), { recursive: true });
    expect(copiedFiles.some((f) => String(f).endsWith('tmp'))).toBe(false);
    expect(copiedFiles.length).toBeGreaterThan(0);
    expect(readdirSync(backupDir).some((f) => f.endsWith('.partial'))).toBe(false);
  });

  it('works for a Host that has no uploads yet', async () => {
    const manifest = await make('daily', new Date());
    expect(existsSync(path.join(backupDir, manifest.name, 'files'))).toBe(true);
  });

  it('ignores partial and foreign folders when listing, newest first', async () => {
    await make('daily', new Date('2026-11-12T10:00:00Z'));
    await make('manual', new Date('2026-11-13T10:00:00Z'));
    await mkdir(path.join(backupDir, 'x.partial'));
    await mkdir(path.join(backupDir, 'random-folder'));
    const list = await listBackups(backupDir);
    expect(list.map((b) => b.kind)).toEqual(['manual', 'daily']);
  });
});

describe('retention', () => {
  const at = (day: number, kind: BackupManifest['kind'] = 'daily', hour = 3): BackupManifest => {
    const createdAt = Date.UTC(2026, 9, 1) + day * DAY + hour * HOUR;
    return {
      name: `b-${day}-${hour}-${kind}`,
      kind,
      createdAt,
      serverVersion: 't',
      complete: true,
    };
  };

  it('keeps 7 daily backups, then one per week for 4 weeks, and drops the rest', () => {
    const backups = Array.from({ length: 60 }, (_, i) => at(i)); // 60 consecutive days
    const now = new Date(Date.UTC(2026, 9, 1) + 59 * DAY + 12 * HOUR);
    const kept = selectBackupsToKeep(backups, now);
    // days 53..59 are the last seven days
    for (let d = 53; d <= 59; d++) expect(kept.has(`b-${d}-3-daily`)).toBe(true);
    expect(kept.size).toBe(7 + 4);
    expect(kept.has('b-0-3-daily')).toBe(false);
  });

  it('keeps only the newest backup of a day', () => {
    const backups = [at(10, 'daily', 3), at(10, 'manual', 15), at(10, 'manual', 9)];
    const kept = selectBackupsToKeep(backups, new Date(at(10).createdAt + DAY));
    expect([...kept]).toEqual(['b-10-15-manual']);
  });

  it('keeps pre-migration backups for 30 days and never deletes the newest backup', () => {
    const old = at(0, 'pre-migration');
    const recent = at(40, 'pre-migration');
    const newest = at(50);
    const now = new Date(newest.createdAt + HOUR);
    const kept = selectBackupsToKeep([old, recent, newest], now);
    expect(kept.has(recent.name)).toBe(true); // 10 days old
    expect(kept.has(newest.name)).toBe(true);
    expect(selectBackupsToKeep([old], new Date(old.createdAt + 90 * DAY)).has(old.name)).toBe(true);
  });

  it('pruneBackups deletes the folders the policy drops', async () => {
    const start = new Date('2026-09-01T03:00:00Z');
    for (let i = 0; i < 12; i++) await make('daily', new Date(start.getTime() + i * DAY));
    const now = new Date(start.getTime() + 11 * DAY + HOUR);
    const removed = await pruneBackups(backupDir, now);
    expect(removed.length).toBeGreaterThan(0);
    const left = await listBackups(backupDir);
    expect(left.length + removed.length).toBe(12);
    expect(left[0]!.createdAt).toBe(start.getTime() + 11 * DAY);
  });
});

describe('status and the daily job', () => {
  it('is stale with no backup, fresh after one, stale again after 36 hours', async () => {
    host.db.insert(hostSettings).values({ key: 'backupDir', value: backupDir }).run();
    expect(await getBackupStatus(host.db, host.dataDir)).toMatchObject({
      backupDir,
      lastBackupAt: null,
      stale: true,
    });
    const t0 = new Date('2026-11-13T03:00:00Z');
    await make('daily', t0);
    const fresh = await getBackupStatus(host.db, host.dataDir, new Date(t0.getTime() + 10 * HOUR));
    expect(fresh.stale).toBe(false);
    expect(fresh.lastBackupAt).toBe(t0.getTime());
    expect(typeof fresh.freeBytes).toBe('number');
    expect(
      (await getBackupStatus(host.db, host.dataDir, new Date(t0.getTime() + 37 * HOUR))).stale,
    ).toBe(true);
  });

  it('the job backs up once a day and catches up after downtime', async () => {
    host.db.insert(hostSettings).values({ key: 'backupDir', value: backupDir }).run();
    const job = backupJob(host.dataDir, 'test');
    const t0 = new Date('2026-11-01T03:00:00Z');
    expect(await runDueJobs(host.db, [job], t0)).toEqual(['backup']);
    expect(await runDueJobs(host.db, [job], new Date(t0.getTime() + 2 * HOUR))).toEqual([]);
    expect(await runDueJobs(host.db, [job], new Date(t0.getTime() + 3 * DAY))).toEqual(['backup']);
    expect(await listBackups(backupDir)).toHaveLength(2);
  });
});

describe('/backups routes', () => {
  it('lets only the owner list backups and run Backup now', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    host.db.insert(hostSettings).values({ key: 'backupDir', value: backupDir }).run();

    for (const method of ['GET', 'POST'] as const) {
      expect((await host.app.inject({ method, url: '/backups' })).statusCode).toBe(401);
      for (const u of [admin, member]) {
        const res = await host.app.inject({ method, url: '/backups', headers: bearer(u.token) });
        expect(res.statusCode, `${u.email} ${method}`).toBe(403);
      }
    }

    const run = await host.app.inject({
      method: 'POST',
      url: '/backups',
      headers: bearer(owner.token),
    });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ kind: 'manual', complete: true });

    const status = await host.app.inject({
      method: 'GET',
      url: '/backups',
      headers: bearer(owner.token),
    });
    expect(status.json()).toMatchObject({ backupDir, stale: false });
    expect(status.json().backups).toHaveLength(1);
  });
});

describe('pendingMigrationCount', () => {
  it('is null for a new database, 0 when current, and counts unapplied migrations', () => {
    const dir = tempDir();
    const fresh = openDatabase(path.join(dir, 'fresh.db'));
    expect(pendingMigrationCount(fresh.db)).toBeNull();
    migrateDatabase(fresh.db);
    expect(pendingMigrationCount(fresh.db)).toBe(0);
    fresh.db.$client
      .prepare(
        'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
      )
      .run();
    expect(pendingMigrationCount(fresh.db)).toBe(1);
    fresh.close();
  });
});

describe('restore', () => {
  it('rebuilds a second Host from a backup: same people, same file bytes, sessions still work', async () => {
    const content = Buffer.from('the brief, version 1');
    const { id } = await addUpload('brief.txt', content);
    const manifest = await make('manual', new Date());

    const second = tempDir();
    expect(await restoreBackup(path.join(backupDir, manifest.name), second)).toBeNull();

    const { db, close } = openDatabase(path.join(second, 'whiteboard.db'));
    migrateDatabase(db);
    const app = buildApp({ db, dataDir: second });
    try {
      const me = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(owner.token) });
      expect(me.statusCode).toBe(200);
      expect(me.json().email).toBe('owner@studio.test');
      const download = await app.inject({
        method: 'GET',
        url: `/files/${id}/content`,
        headers: bearer(owner.token),
      });
      expect(download.statusCode).toBe(200);
      expect(Buffer.compare(download.rawPayload, content)).toBe(0);
    } finally {
      await app.close();
      close();
    }
  });

  it('refuses to overwrite existing data unless asked, then keeps the old data aside', async () => {
    const manifest = await make('manual', new Date());
    const folder = path.join(backupDir, manifest.name);
    const target = tempDir();
    await restoreBackup(folder, target);
    await expect(restoreBackup(folder, target)).rejects.toThrow(RestoreError);

    const moved = await restoreBackup(folder, target, { replace: true });
    expect(moved).not.toBeNull();
    expect(existsSync(path.join(moved!, 'whiteboard.db'))).toBe(true);
    expect(existsSync(path.join(target, 'whiteboard.db'))).toBe(true);
  });

  it('refuses incomplete or damaged backups and leaves the target untouched', async () => {
    const target = tempDir();
    await expect(restoreBackup(tempDir(), target)).rejects.toThrow(/not a finished backup/);

    const manifest = await make('manual', new Date());
    const folder = path.join(backupDir, manifest.name);
    const dbFile = path.join(folder, 'whiteboard.db');
    const original = await readFile(dbFile);
    await writeFile(dbFile, Buffer.concat([original.subarray(0, 2000), Buffer.alloc(3000, 7)]));
    await expect(restoreBackup(folder, target)).rejects.toThrow();
    expect(existsSync(path.join(target, 'whiteboard.db'))).toBe(false);
  });
});
