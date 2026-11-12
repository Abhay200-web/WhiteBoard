import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkspaceRole } from '@whiteboard/core';
import {
  credentials,
  memberships,
  migrateDatabase,
  openDatabase,
  users,
  workspaces,
  type Db,
} from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { buildApp, type AppOptions } from './app';
import { hashPassword } from './auth/password';
import { createSession } from './auth/sessions';

export interface TestHost {
  db: Db;
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

/** A Host on a temp SQLite file. Call `cleanup()` in `afterEach`. */
export function createTestHost(opts: Partial<AppOptions> = {}): TestHost {
  const tmp = mkdtempSync(path.join(tmpdir(), 'wb-test-'));
  const { db, close } = openDatabase(path.join(tmp, 'test.db'));
  migrateDatabase(db);
  // Tests make many sign-ins; keep the limit high unless a test lowers it.
  const app = buildApp({ db, authRateLimit: { max: 1000, timeWindow: '1 minute' }, ...opts });
  return {
    db,
    app,
    cleanup: async () => {
      await app.close();
      close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/** Inserts a user (+ membership in `workspaceId`) directly and returns a ready bearer token. */
export async function seedUser(
  db: Db,
  workspaceId: string,
  role: WorkspaceRole,
  opts: { email?: string; password?: string; mustChangePassword?: boolean; expiresAt?: Date } = {},
): Promise<{ id: string; email: string; password: string; token: string }> {
  const id = randomUUID();
  const email = opts.email ?? `${role}-${id.slice(0, 6)}@studio.test`;
  const password = opts.password ?? 'a-long-test-password';
  const now = new Date();
  db.insert(users)
    .values({
      id,
      email,
      name: role,
      mustChangePassword: opts.mustChangePassword ?? false,
      createdAt: now,
    })
    .run();
  db.insert(credentials)
    .values({ userId: id, passwordHash: await hashPassword(password), updatedAt: now })
    .run();
  db.insert(memberships)
    .values({ workspaceId, userId: id, role, expiresAt: opts.expiresAt ?? null })
    .run();
  return { id, email, password, token: createSession(db, id).token };
}

export function removeMember(db: Db, userId: string): void {
  db.update(memberships).set({ removedAt: new Date() }).where(eq(memberships.userId, userId)).run();
}

export const SETUP_BODY = {
  workspaceName: 'Studio',
  ownerName: 'Owner',
  email: 'owner@studio.test',
  password: 'correct-horse-battery',
};

/** Runs `/setup` and returns the owner's token and the workspace id. */
export async function setupOwner(host: TestHost): Promise<{ token: string; workspaceId: string }> {
  const res = await host.app.inject({ method: 'POST', url: '/setup', payload: SETUP_BODY });
  const workspace = host.db.select().from(workspaces).get()!;
  return { token: res.json().token as string, workspaceId: workspace.id };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
