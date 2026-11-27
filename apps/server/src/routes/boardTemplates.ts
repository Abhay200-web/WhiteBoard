import { randomUUID } from 'node:crypto';

import {
  boardTemplateListSchema,
  boardTemplateSchema,
  createBoardTemplateRequestSchema,
  templateCards,
  type BoardTemplate,
} from '@whiteboard/core';
import { boardTemplates, users, type Db } from '@whiteboard/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { BUILT_IN_TEMPLATES } from '../boards/templates';
import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { isAdmin } from '../projects/access';

const STAFF_ROLES = ['owner', 'admin', 'member'] as const;

const builtIns: BoardTemplate[] = BUILT_IN_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  builtIn: true,
  cardCount: t.cards.length,
  createdBy: null,
  createdByName: null,
}));

/**
 * Board templates: the built-in ones, and boards saved as templates by the studio's staff. Anyone
 * on staff can use and save them; a saved one is deleted by whoever saved it, or an admin.
 * Freelancers see only the built-in templates. A new board is started from one with
 * `POST /boards/:id/boards` and `templateId`.
 */
export const boardTemplateRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const staff = [authenticate(db), requireRole(STAFF_ROLES)];

  function saved(workspaceId: string): BoardTemplate[] {
    return db
      .select({ template: boardTemplates, createdByName: users.name })
      .from(boardTemplates)
      .innerJoin(users, eq(users.id, boardTemplates.createdBy))
      .where(eq(boardTemplates.workspaceId, workspaceId))
      .orderBy(asc(boardTemplates.name))
      .all()
      .map(({ template, createdByName }) => ({
        id: template.id,
        name: template.name,
        builtIn: false,
        cardCount: Array.isArray(template.cards) ? template.cards.length : 0,
        createdBy: template.createdBy,
        createdByName,
      }));
  }

  app.get('/board-templates', { preHandler: signedIn }, async (request) => {
    const auth = request.auth!;
    const mine = auth.user.role === 'guest' ? [] : saved(auth.workspaceId);
    return boardTemplateListSchema.parse([...builtIns, ...mine]);
  });

  app.post('/board-templates', { preHandler: staff }, async (request, reply) => {
    const parsed = createBoardTemplateRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const auth = request.auth!;
    const id = randomUUID();
    db.insert(boardTemplates)
      .values({
        id,
        workspaceId: auth.workspaceId,
        name: parsed.data.name,
        cards: templateCards(parsed.data.cards),
        createdBy: auth.user.id,
        createdAt: new Date(),
      })
      .run();
    const created = saved(auth.workspaceId).find((t) => t.id === id)!;
    return reply.code(201).send(boardTemplateSchema.parse(created));
  });

  app.delete('/board-templates/:id', { preHandler: staff }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = request.auth!;
    const row = db
      .select()
      .from(boardTemplates)
      .where(and(eq(boardTemplates.id, id), eq(boardTemplates.workspaceId, auth.workspaceId)))
      .get();
    if (!row) return sendError(reply, 404, 'not_found', 'Template not found');
    if (row.createdBy !== auth.user.id && !isAdmin(auth)) {
      return sendError(
        reply,
        403,
        'forbidden',
        'Only whoever saved a template, or an admin, can delete it',
      );
    }
    db.delete(boardTemplates).where(eq(boardTemplates.id, id)).run();
    return reply.code(204).send();
  });
};
