import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hostInfoSchema } from '@whiteboard/core';
import { migrateDatabase, openDatabase, users, workspaces, type Db } from '@whiteboard/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app';
import { SERVER_VERSION } from '../version';

describe('GET /host/info', () => {
  let tmp: string;
  let db: Db;
  let closeDb: () => void;
  let app: FastifyInstance;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wb-test-'));
    ({ db, close: closeDb } = openDatabase(path.join(tmp, 'test.db')));
    migrateDatabase(db);
    app = buildApp({ db, dataDir: tmp });
  });

  afterEach(async () => {
    await app.close();
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reports a fresh Host as not set up', async () => {
    const res = await app.inject({ method: 'GET', url: '/host/info' });

    expect(res.statusCode).toBe(200);
    expect(hostInfoSchema.parse(res.json())).toEqual({
      workspaceName: null,
      serverVersion: SERVER_VERSION,
      setupDone: false,
    });
  });

  it('reports the workspace name once setup is done', async () => {
    const now = new Date();
    db.insert(users)
      .values({ id: 'u1', email: 'owner@studio.test', name: 'Owner', createdAt: now })
      .run();
    db.insert(workspaces).values({ id: 'w1', name: 'Studio', ownerId: 'u1', createdAt: now }).run();

    const res = await app.inject({ method: 'GET', url: '/host/info' });

    expect(res.json()).toMatchObject({ workspaceName: 'Studio', setupDone: true });
  });
});
