import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { SessionUser, WorkspaceRole } from '@whiteboard/core';
import { memberships, sessions, users, type Db } from '@whiteboard/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Sessions last 30 days from last use (sliding). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(
  db: Db,
  userId: string,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({
      id: randomUUID(),
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    })
    .run();
  return { token, expiresAt };
}

export function revokeSessionByToken(db: Db, token: string): void {
  db.delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .run();
}

/** Signs a user out everywhere, optionally keeping the current device's session. */
export function revokeAllSessions(db: Db, userId: string, exceptTokenHash?: string): void {
  const rows = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
  for (const row of rows) {
    if (row.tokenHash !== exceptTokenHash) db.delete(sessions).where(eq(sessions.id, row.id)).run();
  }
}

export interface AuthContext {
  user: SessionUser;
  workspaceId: string;
  tokenHash: string;
}

/** Resolves a bearer token to a user, or `null` if invalid, expired, removed or guest-expired. */
export function resolveSession(db: Db, token: string, now = new Date()): AuthContext | null {
  const tokenHash = hashToken(token);
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      user: users,
      role: memberships.role,
      workspaceId: memberships.workspaceId,
      memberExpiresAt: memberships.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.removedAt)))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
  if (!row) return null;
  if (row.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, row.sessionId)).run();
    return null;
  }
  if (row.memberExpiresAt && row.memberExpiresAt <= now) return null;

  db.update(sessions)
    .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    .where(eq(sessions.id, row.sessionId))
    .run();

  return {
    tokenHash,
    workspaceId: row.workspaceId,
    user: {
      id: row.user.id,
      email: row.user.email,
      name: row.user.name,
      role: row.role as WorkspaceRole,
      mustChangePassword: row.user.mustChangePassword,
    },
  };
}
