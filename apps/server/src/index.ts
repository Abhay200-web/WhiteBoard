// Host server entry point: open the database, run migrations, listen on the LAN (spec §7.9).
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { migrateDatabase, openDatabase, pendingMigrationCount } from '@whiteboard/db';

import { buildApp } from './app';
import { createBackup, getBackupDir } from './backups/backup';
import { loadConfig } from './config';
import { announceHost } from './discovery';
import { backupJob } from './jobs/backup';
import { guestExpiryJob } from './jobs/guest-expiry';
import { startScheduler } from './scheduler';
import { SERVER_VERSION } from './version';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const { db, close } = openDatabase(path.join(config.dataDir, 'whiteboard.db'));

// An update that changes the database schema first takes a safety backup, so a bad migration
// can be undone with `restore`.
if ((pendingMigrationCount(db) ?? 0) > 0) {
  await createBackup(db, config.dataDir, getBackupDir(db, config.dataDir), {
    kind: 'pre-migration',
    serverVersion: SERVER_VERSION,
  });
}
migrateDatabase(db);

const app = buildApp({ db, dataDir: config.dataDir, logger: true });

await app.listen({ host: config.host, port: config.port });

const stopScheduler = startScheduler(
  db,
  [guestExpiryJob, backupJob(config.dataDir, SERVER_VERSION)],
  {
    onError: (err) => app.log.error(err, 'scheduler failed'),
  },
);

// Only announce when other PCs can actually reach this Host.
const localOnly = config.host === '127.0.0.1' || config.host === 'localhost';
const stopAnnouncing = localOnly
  ? () => undefined
  : announceHost({ port: config.port, version: SERVER_VERSION }, (err) =>
      app.log.warn(err, 'mDNS announce failed (clients can still connect by IP)'),
    );

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopScheduler();
    stopAnnouncing();
    void app.close().finally(() => {
      close();
      process.exit(0);
    });
  });
}
