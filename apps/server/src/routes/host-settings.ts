import { access, constants, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { updateHostSettingsSchema, type HostSettings } from '@whiteboard/core';
import { hostSettings, type Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { getBackupDir } from '../backups/backup';
import { authenticate, requireRole, sendError } from '../plugins/auth';
import { getMaxUploadBytes } from './files';

function setSetting(db: Db, key: string, value: string | number) {
  db.insert(hostSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: hostSettings.key, set: { value } })
    .run();
}

/** Backup folder and upload limit. Owner only. */
export const hostSettingsRoutes: FastifyPluginAsync<{ db: Db; dataDir: string }> = async (
  app,
  { db, dataDir },
) => {
  const ownerOnly = [authenticate(db), requireRole(['owner'])];
  const read = (): HostSettings => ({
    backupDir: getBackupDir(db, dataDir),
    maxUploadBytes: getMaxUploadBytes(db),
  });

  app.get('/host/settings', { preHandler: ownerOnly }, async () => read());

  app.patch('/host/settings', { preHandler: ownerOnly }, async (request, reply) => {
    const parsed = updateHostSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid');
    }
    const { backupDir, maxUploadBytes } = parsed.data;
    if (backupDir !== undefined) {
      if (!path.isAbsolute(backupDir)) {
        return sendError(reply, 400, 'invalid_request', 'Use a full folder path, like D:\\Backups');
      }
      try {
        await mkdir(backupDir, { recursive: true });
        await access(backupDir, constants.W_OK);
      } catch {
        return sendError(reply, 400, 'invalid_request', 'The Host cannot write to that folder');
      }
      setSetting(db, 'backupDir', path.normalize(backupDir));
    }
    if (maxUploadBytes !== undefined) setSetting(db, 'maxUploadBytes', maxUploadBytes);
    return read();
  });
};
