import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';
import { formatBytes } from './HostSection';

const ADMIN: SessionUser = { ...OWNER, id: 'u9', email: 'admin@studio.test', role: 'admin' };

const manifest = (name: string, kind: 'daily' | 'manual', createdAt: number) => ({
  name,
  kind,
  createdAt,
  serverVersion: '0.1.0',
});

function mockBackups(overrides: Record<string, unknown> = {}) {
  server.use(
    http.get('*/backups', () =>
      HttpResponse.json({
        backupDir: 'D:\\Backups',
        lastBackupAt: Date.now() - 3_600_000,
        stale: false,
        freeBytes: 5 * 1024 ** 3,
        backups: [manifest('b1', 'daily', Date.now() - 3_600_000)],
        ...overrides,
      }),
    ),
    http.get('*/host/settings', () =>
      HttpResponse.json({ backupDir: 'D:\\Backups', maxUploadBytes: 2 * 1024 ** 3 }),
    ),
  );
}

describe('formatBytes', () => {
  it('uses KB, MB and GB', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('Host settings', () => {
  it('shows last backup, free space and the list for the owner, with no stale warning', async () => {
    mockHost({}, OWNER);
    mockBackups();
    renderApp('/settings/host', 'tok');
    expect(await screen.findByText(/Free space on the backup drive: 5.0 GB/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Recent backups' });
    expect(within(list).getByText('Daily')).toBeInTheDocument();
    expect(screen.getByLabelText('Backup folder')).toHaveValue('D:\\Backups');
    expect(screen.getByLabelText(/Largest file/)).toHaveValue(2048);
  });

  it('warns when backups are stale or missing', async () => {
    mockHost({}, OWNER);
    mockBackups({ stale: true, lastBackupAt: null, backups: [] });
    renderApp('/settings/host', 'tok');
    expect(await screen.findByRole('alert')).toHaveTextContent('No backup has been made yet');
  });

  it('runs Backup now and refreshes the list', async () => {
    mockHost({}, OWNER);
    let made = false;
    server.use(
      http.get('*/backups', () =>
        HttpResponse.json({
          backupDir: 'D:\\Backups',
          lastBackupAt: made ? Date.now() : null,
          stale: !made,
          freeBytes: null,
          backups: made ? [manifest('m1', 'manual', Date.now())] : [],
        }),
      ),
      http.post('*/backups', () => {
        made = true;
        return HttpResponse.json(manifest('m1', 'manual', Date.now()), { status: 201 });
      }),
      http.get('*/host/settings', () =>
        HttpResponse.json({ backupDir: 'D:\\Backups', maxUploadBytes: 2 * 1024 ** 3 }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/settings/host', 'tok');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Free space on the backup drive: unknown/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Backup now' }));
    expect(await screen.findByText('Manual')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('saves the backup folder and upload limit, and shows server errors', async () => {
    mockHost({}, OWNER);
    mockBackups();
    let body: unknown;
    server.use(
      http.patch('*/host/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(body as Record<string, unknown>);
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/host', 'tok');
    const folder = await screen.findByLabelText('Backup folder');
    await user.clear(folder);
    await user.type(folder, 'E:\\Safe');
    const limit = screen.getByLabelText(/Largest file/);
    await user.clear(limit);
    await user.type(limit, '500');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(body).toEqual({ backupDir: 'E:\\Safe', maxUploadBytes: 500 * 1024 * 1024 });

    server.use(
      http.patch('*/host/settings', () =>
        HttpResponse.json(
          { error: 'invalid_request', message: 'The Host cannot write to that folder' },
          { status: 400 },
        ),
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('The Host cannot write to that folder')).toBeInTheDocument();
  });

  it('validates the form before calling the Host', async () => {
    mockHost({}, OWNER);
    mockBackups();
    const user = userEvent.setup();
    renderApp('/settings/host', 'tok');
    await user.clear(await screen.findByLabelText('Backup folder'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Enter the backup folder')).toBeInTheDocument();
  });

  it('tells admins that only the owner manages backups, without calling the owner-only API', async () => {
    mockHost({}, ADMIN);
    renderApp('/settings/host', 'tok');
    expect(await screen.findByText(/Only the owner manages backups/)).toBeInTheDocument();
  });
});
