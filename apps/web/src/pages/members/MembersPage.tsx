import { useQuery } from '@tanstack/react-query';
import { inviteListSchema, memberListSchema, type Member } from '@whiteboard/core';
import { Button, Card, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { InviteDialog } from './InviteDialog';
import { PendingInvites } from './PendingInvites';
import { RemoveMemberDialog, ResetPasswordDialog } from './MemberDialogs';

type Dialog =
  | { kind: 'invite' }
  | { kind: 'reset'; member: Member }
  | { kind: 'remove'; member: Member }
  | null;

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Mirrors the Host's rule: the owner manages everyone else, admins manage members and guests. */
function canManage(actor: Member['role'], target: Member['role']) {
  if (actor === 'owner') return target !== 'owner';
  if (actor === 'admin') return target === 'member' || target === 'guest';
  return false;
}

export function MembersPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api('/members', { schema: memberListSchema }),
  });
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => api('/invites', { schema: inviteListSchema }),
  });
  if (!user) return null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <Button onClick={() => setDialog({ kind: 'invite' })}>Invite someone</Button>
      </div>

      <Card className="p-0">
        {members.isPending ? (
          <div className="p-6 text-muted">
            <Spinner />
          </div>
        ) : members.isError ? (
          <p role="alert" className="p-6 text-sm text-danger">
            Could not load members.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Access</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-muted">{m.email}</div>
                  </td>
                  <td className="px-4 py-3 capitalize">{m.role}</td>
                  <td className="px-4 py-3 text-muted">
                    {m.expiresAt ? `Until ${formatDate(m.expiresAt)}` : 'No end date'}
                    {m.mustChangePassword && <div>Must set a new password</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.id !== user.id && canManage(user.role, m.role) && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          aria-label={`Reset password for ${m.name}`}
                          onClick={() => setDialog({ kind: 'reset', member: m })}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Remove ${m.name}`}
                          onClick={() => setDialog({ kind: 'remove', member: m })}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <PendingInvites invites={invites.data} loading={invites.isPending} />

      {dialog?.kind === 'invite' && (
        <InviteDialog canInviteAdmin={user.role === 'owner'} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveMemberDialog member={dialog.member} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
