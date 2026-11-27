import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';
import { isPrivateAddress, parseMeta, previewLink, LinkPreviewError } from './linkPreview';

describe('which addresses a preview may reach', () => {
  it('refuses this computer, the office network and other non-public addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.5',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.10.10',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('reading a page for its title and description', () => {
  it('prefers the Open Graph tags and falls back to the page title', () => {
    const html = `<html><head><title>Plain &amp; simple</title>
      <meta property="og:title" content="Logo &quot;ideas&quot;">
      <meta name="description" content="Plain description"></head></html>`;
    expect(parseMeta(html)).toEqual({ title: 'Logo "ideas"', description: 'Plain description' });
    expect(parseMeta('<title>Only a title</title>')).toEqual({
      title: 'Only a title',
      description: '',
    });
  });
});

describe('previewLink refuses what it must not fetch', () => {
  it.each([
    ['not an address', 'notaurl'],
    ['a non-web scheme', 'ftp://example.com/file'],
    ['an address with a login', 'https://user:pass@example.com/'],
    ['this computer', 'http://127.0.0.1/admin'],
    ['localhost', 'http://localhost:47800/host/info'],
    ['the office network', 'http://192.168.1.1/'],
  ])('refuses %s', async (_label, url) => {
    await expect(previewLink(url)).rejects.toBeInstanceOf(LinkPreviewError);
  });
});

describe('POST /boards/:id/link-preview', () => {
  let host: TestHost;
  let owner: { token: string; workspaceId: string };
  beforeEach(async () => {
    host = createTestHost();
    owner = await setupOwner(host);
  });
  afterEach(() => host.cleanup());

  it('answers 422 for an address on this computer, and 404 for someone not on the project', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const stranger = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await host.app.inject({
        method: 'POST',
        url: '/projects',
        headers: bearer(manager.token),
        payload: { name: 'Refs' },
      })
    ).json() as { id: string };
    const root = (
      await host.app.inject({
        method: 'GET',
        url: `/projects/${project.id}/boards/root`,
        headers: bearer(manager.token),
      })
    ).json() as { id: string };

    const blocked = await host.app.inject({
      method: 'POST',
      url: `/boards/${root.id}/link-preview`,
      headers: bearer(manager.token),
      payload: { url: 'http://127.0.0.1/' },
    });
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as { error: string }).error).toBe('link_preview_failed');

    const outsider = await host.app.inject({
      method: 'POST',
      url: `/boards/${root.id}/link-preview`,
      headers: bearer(stranger.token),
      payload: { url: 'https://example.com/' },
    });
    expect(outsider.statusCode).toBe(404);
  });
});
