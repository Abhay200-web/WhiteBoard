import {
  authResponseSchema,
  changePasswordRequestSchema,
  signInRequestSchema,
  updateProfileRequestSchema,
  type AuthResponse,
} from '@whiteboard/core';
import { credentials, memberships, users, type Db } from '@whiteboard/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';
import { createSession, revokeAllSessions, revokeSessionByToken } from '../auth/sessions';
import { ALL_ROLES, authenticate, requireRole, sendError } from '../plugins/auth';
import type { RateLimitOptions } from './setup';

export const authRoutes: FastifyPluginAsync<{ db: Db; rateLimit: RateLimitOptions }> = async (
  app,
  { db, rateLimit },
) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES, { allowPasswordChangePending: true })];

  app.post('/auth/sign-in', { config: { rateLimit } }, async (request, reply) => {
    const parsed = signInRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'invalid_request', 'Email and password are required');
    }
    const { email, password } = parsed.data;

    const row = db
      .select({
        user: users,
        passwordHash: credentials.passwordHash,
        role: memberships.role,
        memberExpiresAt: memberships.expiresAt,
      })
      .from(users)
      .innerJoin(credentials, eq(credentials.userId, users.id))
      .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.removedAt)))
      .where(eq(users.email, email))
      .get();

    // Always run one scrypt so response time does not reveal whether the email exists.
    const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
    const now = new Date();
    if (!row || !ok || (row.memberExpiresAt && row.memberExpiresAt <= now)) {
      return sendError(reply, 401, 'invalid_credentials', 'Wrong email or password');
    }

    const session = createSession(db, row.user.id, now);
    const body: AuthResponse = authResponseSchema.parse({
      token: session.token,
      expiresAt: session.expiresAt.getTime(),
      user: {
        id: row.user.id,
        email: row.user.email,
        name: row.user.name,
        role: row.role,
        mustChangePassword: row.user.mustChangePassword,
      },
    });
    return body;
  });

  app.get('/auth/me', { preHandler: signedIn }, async (request) => request.auth!.user);

  app.patch('/auth/me', { preHandler: signedIn }, async (request, reply) => {
    const parsed = updateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'invalid_request', 'Name is required');
    const auth = request.auth!;
    db.update(users).set({ name: parsed.data.name }).where(eq(users.id, auth.user.id)).run();
    return { ...auth.user, name: parsed.data.name };
  });

  app.post('/auth/sign-out', { preHandler: [authenticate(db)] }, async (request, reply) => {
    revokeSessionByToken(db, request.headers.authorization!.slice(7).trim());
    return reply.code(204).send();
  });

  app.post(
    '/auth/change-password',
    { config: { rateLimit }, preHandler: signedIn },
    async (request, reply) => {
      const parsed = changePasswordRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          400,
          'invalid_request',
          parsed.error.issues[0]?.message ?? 'Invalid request',
        );
      }
      const auth = request.auth!;
      const { currentPassword, newPassword } = parsed.data;
      const cred = db.select().from(credentials).where(eq(credentials.userId, auth.user.id)).get();
      if (!cred || !(await verifyPassword(currentPassword, cred.passwordHash))) {
        return sendError(reply, 403, 'invalid_credentials', 'Current password is wrong');
      }
      if (newPassword === currentPassword) {
        return sendError(reply, 400, 'invalid_request', 'New password must be different');
      }
      const now = new Date();
      const passwordHash = await hashPassword(newPassword);
      db.transaction((tx) => {
        tx.update(credentials)
          .set({ passwordHash, updatedAt: now })
          .where(eq(credentials.userId, auth.user.id))
          .run();
        tx.update(users).set({ mustChangePassword: false }).where(eq(users.id, auth.user.id)).run();
      });
      // Other devices are signed out; this one stays.
      revokeAllSessions(db, auth.user.id, auth.tokenHash);
      return reply.code(204).send();
    },
  );
};
