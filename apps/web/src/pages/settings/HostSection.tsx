import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  backupManifestSchema,
  backupStatusSchema,
  hostSettingsSchema,
  type BackupInfo,
  type BackupStatus,
  type HostSettings,
} from '@whiteboard/core';
import { Button, Card, Field, Input, Modal, Spinner } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { desktopBridge, desktopErrorText, useDesktopMode } from '../../lib/desktop';

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}

const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const KIND_LABEL = { daily: 'Daily', manual: 'Manual', 'pre-migration': 'Before update' } as const;

function BackupCard({ status }: { status: BackupStatus }) {
  const queryClient = useQueryClient();
  const backupNow = useMutation({
    mutationFn: () => api('/backups', { method: 'POST', schema: backupManifestSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Backups</h2>
          <p className="mt-1 text-sm text-muted">
            Last backup: {status.lastBackupAt ? formatDateTime(status.lastBackupAt) : 'never'}
          </p>
          <p className="text-sm text-muted">
            Free space on the backup drive:{' '}
            {status.freeBytes === null ? 'unknown' : formatBytes(status.freeBytes)}
          </p>
        </div>
        <Button loading={backupNow.isPending} onClick={() => backupNow.mutate()}>
          Backup now
        </Button>
      </div>
      {status.stale && (
        <p role="alert" className="mt-3 rounded-md bg-surface-2 p-3 text-sm text-danger">
          {status.lastBackupAt
            ? 'The last backup is more than 36 hours old. Check that this PC and the backup drive are on.'
            : 'No backup has been made yet. Click "Backup now" to make the first one.'}
        </p>
      )}
      <FormError message={backupNow.error instanceof ApiError ? backupNow.error.message : null} />
      {status.backups.length > 0 && (
        <ul aria-label="Recent backups" className="mt-4 divide-y divide-line text-sm">
          {status.backups.slice(0, 8).map((b) => (
            <li key={b.name} className="flex justify-between py-1.5">
              <span>{formatDateTime(b.createdAt)}</span>
              <span className="text-muted">{KIND_LABEL[b.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StorageForm({ settings }: { settings: HostSettings }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: { backupDir: string; maxUploadBytes: number }) =>
      api('/host/settings', { method: 'PATCH', body, schema: hostSettingsSchema }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['host-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const data = new FormData(event.currentTarget);
    const backupDir = String(data.get('backupDir') ?? '').trim();
    const limitMb = Number(data.get('maxUploadMb'));
    if (!backupDir) return setError('Enter the backup folder');
    if (!Number.isFinite(limitMb) || limitMb < 1) return setError('Enter a size of 1 MB or more');
    setError(null);
    save.mutate({ backupDir, maxUploadBytes: Math.round(limitMb * MB) });
  }

  return (
    <Card>
      <h2 className="font-semibold">Storage</h2>
      <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-3">
        <Field label="Backup folder">
          <Input name="backupDir" defaultValue={settings.backupDir} />
        </Field>
        <p className="-mt-1 text-xs text-muted">
          Use a folder on a different drive from the Host data, such as an external disk.
        </p>
        <Field label="Largest file people can upload (MB)">
          <Input
            name="maxUploadMb"
            type="number"
            min={1}
            defaultValue={Math.round(settings.maxUploadBytes / MB)}
          />
        </Field>
        <FormError
          message={error ?? (save.error instanceof ApiError ? save.error.message : null)}
        />
        {saved && !error && <p className="text-sm text-success">Settings saved.</p>}
        <Button type="submit" variant="secondary" loading={save.isPending} className="self-start">
          Save settings
        </Button>
      </form>
    </Card>
  );
}

const KEPT_NOTE = (
  <>
    Your current data is kept in a <code>restore-previous-...</code> folder, so nothing is deleted.
  </>
);

/**
 * In the Host PC's desktop app: pick a backup and restore it (the app stops the server, restores,
 * and starts it again). On a client PC: where to do it. In a browser (dev): the command.
 */
function RestoreCard({ status }: { status: BackupStatus }) {
  const mode = useDesktopMode();
  const [chosen, setChosen] = useState<BackupInfo | null>(null);
  const restore = useMutation({
    mutationFn: (name: string) => desktopBridge()!.restoreBackup(status.backupDir, name),
  });

  if (mode.data !== 'host') {
    return (
      <Card>
        <h2 className="font-semibold">Restore</h2>
        {mode.data === 'client' ? (
          <p className="mt-2 text-sm text-muted">
            Backups are restored on the Host PC: open Whiteboard there and go to Settings &gt; Host.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              Restoring replaces everything on a Host, so it is done with the Host stopped. Stop the
              Host, then run this in the Whiteboard folder (use the backup folder you want to go
              back to):
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">
              pnpm --filter @whiteboard/server restore &lt;backup folder&gt; --replace
            </pre>
            <p className="mt-2 text-sm text-muted">{KEPT_NOTE}</p>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-semibold">Restore</h2>
      <p className="mt-2 text-sm text-muted">
        Go back to a backup. Whiteboard stops for a moment while it restores. {KEPT_NOTE}
      </p>
      {status.backups.length === 0 ? (
        <p className="mt-3 text-sm text-muted">There are no backups yet.</p>
      ) : (
        <ul aria-label="Backups to restore" className="mt-3 divide-y divide-line text-sm">
          {status.backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-4 py-1.5">
              <span>
                {formatDateTime(b.createdAt)}{' '}
                <span className="text-muted">({KIND_LABEL[b.kind]})</span>
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  restore.reset();
                  setChosen(b);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <Modal
          title={restore.isSuccess ? 'Backup restored' : 'Restore this backup?'}
          onClose={() => !restore.isPending && setChosen(null)}
        >
          {restore.isSuccess ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                Whiteboard is back to how it was on {formatDateTime(chosen.createdAt)}.
              </p>
              <p className="text-xs break-all whitespace-pre-line text-muted">{restore.data}</p>
              {/* Every page's data changed underneath; start again from a clean load. */}
              <Button onClick={() => window.location.assign('/')}>Continue</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                Whiteboard goes back to how it was on {formatDateTime(chosen.createdAt)}. Changes
                made after that are set aside, and people who are connected see
                &quot;Reconnecting&quot; for a moment. {KEPT_NOTE}
              </p>
              <FormError message={restore.error ? desktopErrorText(restore.error) : null} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setChosen(null)}
                  disabled={restore.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={restore.isPending}
                  onClick={() => restore.mutate(chosen.name)}
                >
                  Restore
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}

/** Backups, storage settings and restore. Only the owner can change them. */
export function HostSection() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => api('/backups', { schema: backupStatusSchema }),
    enabled: isOwner,
  });
  const settings = useQuery({
    queryKey: ['host-settings'],
    queryFn: () => api('/host/settings', { schema: hostSettingsSchema }),
    enabled: isOwner,
  });

  if (user && user.role !== 'owner' && user.role !== 'admin') {
    return <Navigate to="/settings/account" replace />;
  }
  if (!isOwner) {
    return (
      <Card className="max-w-md">
        <h2 className="font-semibold">Host</h2>
        <p className="mt-2 text-sm text-muted">Only the owner manages backups and storage.</p>
      </Card>
    );
  }
  if (backups.isPending || settings.isPending) return <Spinner />;
  if (!backups.data || !settings.data) {
    return <FormError message="Could not load the Host settings." />;
  }
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <BackupCard status={backups.data} />
      <StorageForm settings={settings.data} />
      <RestoreCard status={backups.data} />
    </div>
  );
}
