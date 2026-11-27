import type { Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { canViewProject } from '../projects/access';
import { buildMarkdown, buildPdf, loadProjectExport } from '../projects/export';
import { buildDocx } from '../projects/exportWord';
import { buildProjectZip } from '../projects/exportFiles';
import { contentDisposition } from './files';

const FORMATS = {
  markdown: { ext: 'md', type: 'text/markdown; charset=utf-8' },
  pdf: { ext: 'pdf', type: 'application/pdf' },
  docx: {
    ext: 'docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  zip: { ext: 'zip', type: 'application/zip' },
} as const;
type Format = keyof typeof FORMATS;

/** Downloads a project as Markdown, PDF, Word or a zip with its files. Only people who can see the project get it. */
export const exportRoutes: FastifyPluginAsync<{ db: Db; dataDir: string }> = async (
  app,
  { db, dataDir },
) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.get('/projects/:id/export', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format } = request.query as { format?: string };
    if (!format || !(format in FORMATS)) {
      return badRequest(reply, 'format must be markdown, pdf, docx or zip');
    }
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const data = loadProjectExport(db, id);
    if (!data) return sendError(reply, 404, 'not_found', 'Project not found');

    const { ext, type } = FORMATS[format as Format];
    const body =
      format === 'markdown'
        ? buildMarkdown(data)
        : format === 'pdf'
          ? Buffer.from(await buildPdf(data))
          : format === 'docx'
            ? await buildDocx(data)
            : Buffer.from(buildProjectZip(db, dataDir, data, id));
    return reply
      .header('content-type', type)
      .header(
        'content-disposition',
        contentDisposition('attachment', `${data.name} - export.${ext}`),
      )
      .send(body);
  });
};
