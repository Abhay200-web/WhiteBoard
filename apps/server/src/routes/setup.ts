import { randomUUID } from 'node:crypto';

import { authResponseSchema, setupRequestSchema, type AuthResponse } from '@whiteboard/core';
import { credentials, memberships, users, workspaces, type Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { hashPassword } from '../auth/password';
import { createSession } from '../auth/sessions';
import { sendError } from '../plugins/auth';

export interface RateLimitOptions {
  max: number;
  timeWindow: string;
}

export const setupRoutes: FastifyPluginAsync<{ db: Db; rateLimit: RateLimitOptions }> = async (
  app,
  { db, rateLimit },
) => {
  app.post('/setup', { config: { rateLimit } }, async (request, reply) => {
    const parsed = setupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { workspaceName, ownerName, email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const userId = randomUUID();
    const workspaceId = randomUUID();

    // Check-and-insert in one synchronous transaction so two racing requests cannot both win.
    const created = db.transaction((tx) => {
      if (tx.select({ id: workspaces.id }).from(workspaces).limit(1).get()) return false;
      tx.insert(users).values({ id: userId, email, name: ownerName, createdAt: now }).run();
      tx.insert(credentials).values({ userId, passwordHash, updatedAt: now }).run();
      tx.insert(workspaces)
        .values({ id: workspaceId, name: workspaceName, ownerId: userId, createdAt: now })
        .run();
      tx.insert(memberships).values({ workspaceId, userId, role: 'owner' }).run();
      return true;
    });
    if (!created) return sendError(reply, 409, 'already_set_up', 'This Host is already set up');

    const session = createSession(db, userId, now);
    const body: AuthResponse = authResponseSchema.parse({
      token: session.token,
      expiresAt: session.expiresAt.getTime(),
      user: { id: userId, email, name: ownerName, role: 'owner', mustChangePassword: false },
    });
    return reply.code(201).send(body);
  });
};
