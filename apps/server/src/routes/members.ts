import { memberListSchema, passwordResetSchema, type WorkspaceRole } from '@whiteboard/core';
import { credentials, memberships, users, type Db } from '@whiteboard/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { generateTemporaryPassword } from '../auth/codes';
import { hashPassword } from '../auth/password';
import { revokeAllSessions } from '../auth/sessions';
import { ADMIN_ROLES, authenticate, requireRole, sendError } from '../plugins/auth';

/** Owner can manage everyone (but not themselves here); admins only members and guests. */
export function canManage(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === 'owner') return target !== 'owner';
  if (actor === 'admin') return target === 'member' || target === 'guest';
  return false;
}

export const memberRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const adminOnly = [authenticate(db), requireRole(ADMIN_ROLES)];

  function findTarget(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    return db
      .select({ user: users, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.userId, id),
          eq(memberships.workspaceId, request.auth!.workspaceId),
          isNull(memberships.removedAt),
        ),
      )
      .get();
  }

  /** Looks up the target and checks the actor may manage them; replies with the error otherwise. */
  function resolveManaged(request: FastifyRequest, reply: FastifyReply) {
    const target = findTarget(request);
    if (!target) {
      void sendError(reply, 404, 'not_found', 'Member not found');
      return null;
    }
    if (target.user.id === request.auth!.user.id) {
      void sendError(reply, 400, 'invalid_request', 'You cannot do this to your own account');
      return null;
    }
    if (!canManage(request.auth!.user.role, target.role)) {
      void sendError(reply, 403, 'forbidden', 'You do not have access to this');
      return null;
    }
    return target;
  }

  app.get('/members', { preHandler: adminOnly }, async (request) => {
    const rows = db
      .select({ user: users, role: memberships.role, expiresAt: memberships.expiresAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(eq(memberships.workspaceId, request.auth!.workspaceId), isNull(memberships.removedAt)),
      )
      .orderBy(users.name)
      .all();
    return memberListSchema.parse(
      rows.map(({ user, role, expiresAt }) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        expiresAt: expiresAt?.getTime() ?? null,
        mustChangePassword: user.mustChangePassword,
      })),
    );
  });

  /** Sets a temporary password, forces a change at next sign-in and signs the member out everywhere. */
  app.post('/members/:id/reset-password', { preHandler: adminOnly }, async (request, reply) => {
    const target = resolveManaged(request, reply);
    if (!target) return;
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    db.transaction((tx) => {
      tx.update(credentials)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(credentials.userId, target.user.id))
        .run();
      tx.update(users).set({ mustChangePassword: true }).where(eq(users.id, target.user.id)).run();
    });
    revokeAllSessions(db, target.user.id);
    return passwordResetSchema.parse({ temporaryPassword });
  });

  /**
   * Offboarding: soft-removes the member (history is kept) and revokes their sessions at once.
   * Reassigning their open tasks is wired in with the tasks feature (Part 4).
   */
  app.delete('/members/:id', { preHandler: adminOnly }, async (request, reply) => {
    const target = resolveManaged(request, reply);
    if (!target) return;
    db.update(memberships)
      .set({ removedAt: new Date(), removedBy: request.auth!.user.id })
      .where(
        and(
          eq(memberships.userId, target.user.id),
          eq(memberships.workspaceId, request.auth!.workspaceId),
        ),
      )
      .run();
    revokeAllSessions(db, target.user.id);
    return reply.code(204).send();
  });
};
