import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createdInviteSchema,
  createInviteRequestSchema,
  type CreatedInvite,
  type InviteRole,
} from '@whiteboard/core';
import { Button, Field, Input, Modal, Select } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { CopyButton } from './CopyButton';

const ROLE_LABELS: Record<InviteRole, string> = {
  member: 'Member (staff)',
  guest: 'Guest (freelancer)',
  admin: 'Admin',
};

/** Local end-of-day for a `yyyy-mm-dd` date input, as Unix ms. */
function endOfDay(date: string): number {
  return new Date(`${date}T23:59:59`).getTime();
}

export function InviteDialog({
  canInviteAdmin,
  onClose,
}: {
  canInviteAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<InviteRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api('/invites', { method: 'POST', body, schema: createdInviteSchema }),
    onSuccess: async (invite) => {
      setCreated(invite);
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = String(new FormData(event.currentTarget).get('guestEnd') ?? '');
    const body = { role, guestExpiresAt: role === 'guest' && date ? endOfDay(date) : undefined };
    const parsed = createInviteRequestSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid input');
    if (parsed.data.guestExpiresAt !== undefined && parsed.data.guestExpiresAt <= Date.now()) {
      return setError('The end date must be in the future');
    }
    setError(null);
    create.mutate(parsed.data);
  }

  if (created) {
    return (
      <Modal title="Invite created" onClose={onClose}>
        <p className="text-sm text-muted">
          Give this code to the new {created.role}. <strong>It is shown only once</strong> — if you
          lose it, revoke the invite and create a new one.
        </p>
        <p
          aria-label="Invite code"
          className="mt-4 rounded-md bg-surface-2 py-3 text-center font-mono text-xl tracking-widest select-all"
        >
          {created.code}
        </p>
        <p className="mt-2 text-xs text-muted">
          They enter it on the “Join your team” screen. It expires in 7 days.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <CopyButton text={created.code} />
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  const apiError = create.error instanceof ApiError ? create.error.message : null;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
            <option value="member">{ROLE_LABELS.member}</option>
            <option value="guest">{ROLE_LABELS.guest}</option>
            {canInviteAdmin && <option value="admin">{ROLE_LABELS.admin}</option>}
          </Select>
        </Field>
        {role === 'guest' && (
          <Field label="Access ends on" hint="Freelancers lose access automatically after this day">
            <Input name="guestEnd" type="date" min={tomorrow} />
          </Field>
        )}
        <FormError message={error ?? apiError} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
