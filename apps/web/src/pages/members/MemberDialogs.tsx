import { useMutation, useQueryClient } from '@tanstack/react-query';
import { passwordResetSchema, type Member } from '@whiteboard/core';
import { Button, Modal } from '@whiteboard/ui';

import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { CopyButton } from './CopyButton';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : err ? 'Something went wrong' : null;

export function ResetPasswordDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const queryClient = useQueryClient();
  const reset = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}/reset-password`, { method: 'POST', schema: passwordResetSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members'] }),
  });

  if (reset.data) {
    return (
      <Modal title="Temporary password" onClose={onClose}>
        <p className="text-sm text-muted">
          Give this to {member.name}. <strong>It is shown only once.</strong> They will choose their
          own password when they sign in.
        </p>
        <p
          aria-label="Temporary password"
          className="mt-4 rounded-md bg-surface-2 py-3 text-center font-mono text-lg tracking-wider select-all"
        >
          {reset.data.temporaryPassword}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <CopyButton text={reset.data.temporaryPassword} />
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Reset password for ${member.name}?`} onClose={onClose}>
      <p className="text-sm text-muted">
        {member.name} will be signed out everywhere and must set a new password.
      </p>
      <div className="mt-4">
        <FormError message={errorText(reset.error)} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={reset.isPending} onClick={() => reset.mutate()}>
          Reset password
        </Button>
      </div>
    </Modal>
  );
}

export function RemoveMemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/members/${member.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
  });

  return (
    <Modal title={`Remove ${member.name}?`} onClose={onClose}>
      <p className="text-sm text-muted">
        {member.name} loses access immediately and is signed out on every device. Their past work
        and comments stay in the projects.
      </p>
      <div className="mt-4">
        <FormError message={errorText(remove.error)} />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          Remove member
        </Button>
      </div>
    </Modal>
  );
}
