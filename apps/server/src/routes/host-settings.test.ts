import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
let extra: string;
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
  extra = mkdtempSync(path.join(tmpdir(), 'wb-settings-'));
});
afterEach(async () => {
  await host.cleanup();
  rmSync(extra, { recursive: true, force: true });
});

const patch = (token: string, payload: unknown) =>
  host.app.inject({
    method: 'PATCH',
    url: '/host/settings',
    payload: payload as object,
    headers: bearer(token),
  });

describe('/host/settings', () => {
  it('is owner only', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    expect((await host.app.inject({ method: 'GET', url: '/host/settings' })).statusCode).toBe(401);
    for (const res of [
      await host.app.inject({ method: 'GET', url: '/host/settings', headers: bearer(admin.token) }),
      await patch(admin.token, { maxUploadBytes: 5_000_000 }),
    ]) {
      expect(res.statusCode).toBe(403);
    }
  });

  it('returns defaults, then saves the backup folder and upload limit', async () => {
    const defaults = await host.app.inject({
      method: 'GET',
      url: '/host/settings',
      headers: bearer(owner.token),
    });
    expect(defaults.json()).toEqual({
      backupDir: path.join(host.dataDir, 'backups'),
      maxUploadBytes: 2 * 1024 ** 3,
    });

    const dir = path.join(extra, 'external-drive', 'backups');
    const res = await patch(owner.token, { backupDir: dir, maxUploadBytes: 50_000_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ backupDir: path.normalize(dir), maxUploadBytes: 50_000_000 });

    // Backups now go to the new folder.
    const run = await host.app.inject({
      method: 'POST',
      url: '/backups',
      headers: bearer(owner.token),
    });
    expect(run.statusCode).toBe(201);
    const status = await host.app.inject({
      method: 'GET',
      url: '/backups',
      headers: bearer(owner.token),
    });
    expect(status.json().backupDir).toBe(path.normalize(dir));
  });

  it('rejects relative paths, unwritable folders, tiny limits and empty bodies', async () => {
    expect((await patch(owner.token, { backupDir: 'backups' })).statusCode).toBe(400);
    const file = path.join(extra, 'a-file');
    await import('node:fs/promises').then((fs) => fs.writeFile(file, 'x'));
    expect((await patch(owner.token, { backupDir: path.join(file, 'sub') })).statusCode).toBe(400);
    expect((await patch(owner.token, { maxUploadBytes: 10 })).statusCode).toBe(400);
    expect((await patch(owner.token, {})).statusCode).toBe(400);
  });
});
