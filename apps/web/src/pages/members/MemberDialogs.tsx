import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { openTaskListSchema, passwordResetSchema, type Member } from '@whiteboard/core';
import { Button, Modal, Select, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../components/AuthShell';
import { api, errorText } from '../../lib/api';
import { CopyButton } from './CopyButton';

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

/**
 * Offboarding: lists the member's open tasks so each can be handed to someone on its project
 * (or left unassigned), then removes them. The Host does it all at once.
 */
export function RemoveMemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [handTo, setHandTo] = useState<Record<string, string>>({});
  const openTasks = useQuery({
    queryKey: ['members', member.id, 'open-tasks'],
    queryFn: () => api(`/members/${member.id}/open-tasks`, { schema: openTaskListSchema }),
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}/remove`, {
        method: 'POST',
        body: {
          reassign: Object.entries(handTo)
            .filter(([, userId]) => userId)
            .map(([taskId, userId]) => ({ taskId, userId })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
  });

  return (
    <Modal title={`Remove ${member.name}?`} onClose={onClose} size="lg">
      <p className="text-sm text-muted">
        {member.name} loses access immediately and is signed out on every device. Their past work
        and comments stay in the projects.
      </p>
      {openTasks.isPending && <Spinner />}
      {openTasks.data && openTasks.data.length > 0 && (
        <section aria-label="Open tasks" className="mt-4">
          <h3 className="text-sm font-medium">Who takes over their open tasks?</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {openTasks.data.map((t) => (
              <li key={t.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-muted"> · {t.projectName}</span>
                </span>
                <Select
                  aria-label={`Give ${t.title} to`}
                  className="w-48"
                  value={handTo[t.taskId] ?? ''}
                  onChange={(e) => setHandTo({ ...handTo, [t.taskId]: e.target.value })}
                >
                  <option value="">Leave unassigned</option>
                  {t.candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-4">
        <FormError message={errorText(remove.error, openTasks.error)} />
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
