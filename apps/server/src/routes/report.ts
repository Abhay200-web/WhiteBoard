import type { Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { ALL_ROLES, authenticate, requireRole, sendError } from '../plugins/auth';
import { canViewProject } from '../projects/access';
import { projectReport } from '../projects/report';

/** The project dashboard: progress, overdue work, workload and review turnaround. */
export const reportRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.get('/projects/:id/report', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    return projectReport(db, id);
  });
};
