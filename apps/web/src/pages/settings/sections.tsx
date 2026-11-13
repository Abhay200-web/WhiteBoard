import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProfileRequestSchema } from '@whiteboard/core';
import { Button, Card, Field, Input } from '@whiteboard/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { useHostInfo } from '../../auth/guards';
import { ChangePasswordForm } from '../../components/ChangePasswordForm';
import { FormError } from '../../components/AuthShell';
import { api, ApiError, getHostUrl } from '../../lib/api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function EditNameForm({ current }: { current: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: { name: string }) => api('/auth/me', { method: 'PATCH', body }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const parsed = updateProfileRequestSchema.safeParse({
      name: String(new FormData(event.currentTarget).get('name') ?? ''),
    });
    if (!parsed.success) return setError('Name is required');
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-3">
      <Field label="Display name">
        <Input name="name" defaultValue={current} autoComplete="name" />
      </Field>
      <FormError message={error ?? (save.error instanceof ApiError ? save.error.message : null)} />
      {saved && !error && <p className="text-sm text-success">Name saved.</p>}
      <Button type="submit" variant="secondary" loading={save.isPending} className="self-start">
        Save name
      </Button>
    </form>
  );
}

export function AccountSection() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex max-w-md flex-col gap-6">
      <Card>
        <h2 className="font-semibold">Profile</h2>
        <dl className="mt-2 divide-y divide-line">
          <Row label="Email">{user.email}</Row>
          <Row label="Role">
            <span className="capitalize">{user.role}</span>
          </Row>
        </dl>
        <EditNameForm current={user.name} />
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Change password</h2>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}

export function ConnectionSection() {
  const host = useHostInfo();
  return (
    <Card className="max-w-md">
      <h2 className="font-semibold">Connection</h2>
      <dl className="mt-2 divide-y divide-line">
        <Row label="Host">{getHostUrl() || window.location.origin}</Row>
        <Row label="Workspace">{host.data?.workspaceName ?? '-'}</Row>
        <Row label="Host version">{host.data?.serverVersion ?? '-'}</Row>
        <Row label="Status">
          {host.isError ? (
            <span className="text-danger">Unreachable</span>
          ) : host.isPending ? (
            'Checking...'
          ) : (
            <span className="text-success">Connected</span>
          )}
        </Row>
      </dl>
      <Link to="/connect" className="mt-4 inline-block text-sm text-accent underline">
        Connect to a different Host
      </Link>
    </Card>
  );
}
