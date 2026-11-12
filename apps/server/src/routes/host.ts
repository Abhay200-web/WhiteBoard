import { hostInfoSchema, type HostInfo } from '@whiteboard/core';
import { workspaces, type Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { SERVER_VERSION } from '../version';

export const hostRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/host/info', async (): Promise<HostInfo> => {
    const workspace = db.select({ name: workspaces.name }).from(workspaces).limit(1).get();
    return hostInfoSchema.parse({
      workspaceName: workspace?.name ?? null,
      serverVersion: SERVER_VERSION,
      setupDone: workspace !== undefined,
    });
  });
};
