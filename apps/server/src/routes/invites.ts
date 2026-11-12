import { randomUUID } from 'node:crypto';

import {
  acceptInviteRequestSchema,
  authResponseSchema,
  createdInviteSchema,
  createInviteRequestSchema,
  INVITE_TTL_DAYS,
  inviteListSchema,
  type AuthResponse,
} from '@whiteboard/core';
import { credentials, invites, memberships, users, type Db } from '@whiteboard/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { generateInviteCode, hashInviteCode } from '../auth/codes';
import { hashPassword } from '../auth/password';
import { createSession } from '../auth/sessions';
import { ADMIN_ROLES, authenticate, requireRole, sendError } from '../plugins/auth';
import type { RateLimitOptions } from './setup';

const DAY_MS = 24 * 60 * 60 * 1000;

export const inviteRoutes: FastifyPluginAsync<{ db: Db; rateLimit: RateLimitOptions }> = async (
  app,
  { db, rateLimit },
) => {
  const adminOnly = [authenticate(db), requireRole(ADMIN_ROLES)];

  app.post('/invites', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = createInviteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const auth = request.auth!;
    const { role, guestExpiresAt } = parsed.data;
    if (role === 'admin' && auth.user.role !== 'owner') {
      return sendError(reply, 403, 'forbidden', 'Only the owner can invite administrators');
    }
    const now = new Date();
    if (guestExpiresAt !== undefined && guestExpiresAt <= now.getTime()) {
      return sendError(reply, 400, 'invalid_request', 'The end date must be in the future');
    }

    const code = generateInviteCode();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    db.insert(invites)
      .values({
        id,
        workspaceId: auth.workspaceId,
        codeHash: hashInviteCode(code),
        role,
        guestExpiresAt: guestExpiresAt === undefined ? null : new Date(guestExpiresAt),
        createdBy: auth.user.id,
        createdAt: now,
        expiresAt,
      })
      .run();

    return reply.code(201).send(
      createdInviteSchema.parse({
        id,
        code,
        role,
        guestExpiresAt: guestExpiresAt ?? null,
        createdAt: now.getTime(),
        expiresAt: expiresAt.getTime(),
        createdByName: auth.user.name,
      }),
    );
  });

  /** Pending invites only (not used, revoked or expired). Codes are never returned. */
  app.get('/invites', { preHandler: adminOnly }, async (request) => {
    const rows = db
      .select({ invite: invites, createdByName: users.name })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.createdBy))
      .where(
        and(
          eq(invites.workspaceId, request.auth!.workspaceId),
          isNull(invites.usedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .all();
    return inviteListSchema.parse(
      rows.map(({ invite, createdByName }) => ({
        id: invite.id,
        role: invite.role,
        guestExpiresAt: invite.guestExpiresAt?.getTime() ?? null,
        createdAt: invite.createdAt.getTime(),
        expiresAt: invite.expiresAt.getTime(),
        createdByName,
      })),
    );
  });

  app.delete('/invites/:id', { preHandler: adminOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invites.id, id),
          eq(invites.workspaceId, request.auth!.workspaceId),
          isNull(invites.usedAt),
          isNull(invites.revokedAt),
        ),
      )
      .run();
    if (result.changes === 0) return sendError(reply, 404, 'not_found', 'Invite not found');
    return reply.code(204).send();
  });

  /** Public: a new member joins with a code. Every failure looks the same to avoid code probing. */
  app.post('/invites/accept', { config: { rateLimit } }, async (request, reply) => {
    const parsed = acceptInviteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { code, name, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const userId = randomUUID();

    type Outcome =
      | { ok: true; role: 'admin' | 'member' | 'guest' }
      | { ok: false; reason: 'invalid' | 'email_taken' };

    // Check, create and consume in one synchronous transaction: a code can only be used once.
    const outcome = db.transaction((tx): Outcome => {
      const invite = tx
        .select()
        .from(invites)
        .where(eq(invites.codeHash, hashInviteCode(code)))
        .get();
      const usable =
        invite &&
        !invite.usedAt &&
        !invite.revokedAt &&
        invite.expiresAt > now &&
        (!invite.guestExpiresAt || invite.guestExpiresAt > now);
      if (!usable) return { ok: false, reason: 'invalid' };
      if (tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
        return { ok: false, reason: 'email_taken' };
      }
      tx.insert(users).values({ id: userId, email, name, createdAt: now }).run();
      tx.insert(credentials).values({ userId, passwordHash, updatedAt: now }).run();
      tx.insert(memberships)
        .values({
          workspaceId: invite.workspaceId,
          userId,
          role: invite.role,
          expiresAt: invite.guestExpiresAt,
        })
        .run();
      tx.update(invites)
        .set({ usedAt: now, usedBy: userId })
        .where(eq(invites.id, invite.id))
        .run();
      return { ok: true, role: invite.role };
    });

    if (!outcome.ok) {
      return outcome.reason === 'email_taken'
        ? sendError(reply, 409, 'email_taken', 'This email already has an account')
        : sendError(reply, 400, 'invalid_invite', 'This invite code is not valid or has expired');
    }

    const session = createSession(db, userId, now);
    const body: AuthResponse = authResponseSchema.parse({
      token: session.token,
      expiresAt: session.expiresAt.getTime(),
      user: { id: userId, email, name, role: outcome.role, mustChangePassword: false },
    });
    return reply.code(201).send(body);
  });
};
