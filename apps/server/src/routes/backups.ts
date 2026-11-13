import type { Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { createBackup, getBackupDir, getBackupStatus, pruneBackups } from '../backups/backup';
import { authenticate, requireRole } from '../plugins/auth';
import { SERVER_VERSION } from '../version';

/** Backups are the owner's job (they hold every password hash and file), so owner only. */
export const backupRoutes: FastifyPluginAsync<{ db: Db; dataDir: string }> = async (
  app,
  { db, dataDir },
) => {
  const ownerOnly = [authenticate(db), requireRole(['owner'])];
  let running = false;

  /** Backup folder, last backup, stale warning, free disk space and the list of backups. */
  app.get('/backups', { preHandler: ownerOnly }, async () => getBackupStatus(db, dataDir));

  /** "Backup now". */
  app.post('/backups', { preHandler: ownerOnly }, async (_request, reply) => {
    if (running) {
      return reply
        .code(409)
        .send({ error: 'backup_running', message: 'A backup is already running' });
    }
    running = true;
    try {
      const dir = getBackupDir(db, dataDir);
      const manifest = await createBackup(db, dataDir, dir, {
        kind: 'manual',
        serverVersion: SERVER_VERSION,
      });
      await pruneBackups(dir);
      return reply.code(201).send(manifest);
    } finally {
      running = false;
    }
  });
};
