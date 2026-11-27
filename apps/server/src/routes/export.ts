import type { Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { canViewProject } from '../projects/access';
import { buildMarkdown, buildPdf, loadProjectExport } from '../projects/export';
import { contentDisposition } from './files';

/** Downloads a project as Markdown or PDF. Only people who can see the project get it. */
export const exportRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.get('/projects/:id/export', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format } = request.query as { format?: string };
    if (format !== 'markdown' && format !== 'pdf') {
      return badRequest(reply, 'format must be markdown or pdf');
    }
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const data = loadProjectExport(db, id);
    if (!data) return sendError(reply, 404, 'not_found', 'Project not found');

    const fileName = `${data.name} - export`;
    if (format === 'markdown') {
      return reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header('content-disposition', contentDisposition('attachment', `${fileName}.md`))
        .send(buildMarkdown(data));
    }
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', contentDisposition('attachment', `${fileName}.pdf`))
      .send(Buffer.from(await buildPdf(data)));
  });
};
