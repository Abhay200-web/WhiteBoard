import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Invite } from '@whiteboard/core';
import { Button, Card } from '@whiteboard/ui';

import { api } from '../../lib/api';

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function PendingInvites({
  invites,
  loading,
}: {
  invites: Invite[] | undefined;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });

  return (
    <section aria-label="Pending invites">
      <h2 className="mb-2 font-semibold">Pending invites</h2>
      <Card className="p-0">
        {loading ? null : !invites || invites.length === 0 ? (
          <p className="p-4 text-sm text-muted">No pending invites.</p>
        ) : (
          <ul>
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 text-sm last:border-0"
              >
                <div>
                  <span className="font-medium capitalize">{invite.role}</span>
                  <span className="text-muted">
                    {' '}
                    · invited by {invite.createdByName} · code expires{' '}
                    {formatDate(invite.expiresAt)}
                    {invite.guestExpiresAt && ` · access ends ${formatDate(invite.guestExpiresAt)}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Revoke ${invite.role} invite`}
                  loading={revoke.isPending && revoke.variables === invite.id}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
