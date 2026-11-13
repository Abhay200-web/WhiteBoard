import { createBackup, getBackupDir, pruneBackups } from '../backups/backup';
import type { Job } from '../scheduler';

/** Daily backup + pruning. A Host that was off at backup time catches up on the next tick. */
export function backupJob(dataDir: string, serverVersion: string): Job {
  return {
    name: 'backup',
    intervalMs: 24 * 60 * 60 * 1000,
    run: async (db, now) => {
      const dir = getBackupDir(db, dataDir);
      await createBackup(db, dataDir, dir, { kind: 'daily', serverVersion, now });
      await pruneBackups(dir, now);
    },
  };
}
