import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationInboxSchema, type Notification } from '@whiteboard/core';
import { Button, cn } from '@whiteboard/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../lib/api';
import { formatDateTime } from '../pages/projects/format';

/** One sentence per notification, e.g. "Mia assigned you Logo concepts". */
function describe(n: Notification): string {
  const task = n.taskTitle ?? 'a task'; // the task may have been deleted since
  switch (n.kind) {
    case 'assigned':
      return `${n.actorName} assigned you ${task}`;
    case 'mentioned':
      return `${n.actorName} mentioned you on ${task}: “${n.detail}”`;
    case 'commented':
      return `${n.actorName} commented on ${task}: “${n.detail}”`;
    case 'status':
      return `${n.actorName} moved ${task} to ${n.detail}`;
    case 'added_to_project':
      return `${n.actorName} added you to ${n.projectName}`;
  }
}

/**
 * The bell in the top bar: unread count, and the latest notifications in a dropdown. Clicking
 * one marks it read and opens its project (and task). The live connection keeps it current.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications', { schema: notificationInboxSchema }),
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) =>
      api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function go(n: Notification) {
    if (n.readAt === null) markRead.mutate([n.id]);
    setOpen(false);
    // Something changed there (a new task, a new member): the open page may hold an older copy.
    void queryClient.invalidateQueries({ queryKey: ['tasks', n.projectId] });
    void queryClient.invalidateQueries({ queryKey: ['project', n.projectId] });
    void navigate(
      n.taskId ? `/projects/${n.projectId}?task=${n.taskId}` : `/projects/${n.projectId}`,
    );
  }

  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];
  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{unread}</span>
        )}
      </Button>
      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 rounded-md border border-line bg-surface p-2 shadow-lg"
        >
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <Button variant="ghost" onClick={() => markRead.mutate(undefined)}>
                Mark all read
              </Button>
            )}
          </div>
          {items.length === 0 && (
            <p className="px-2 pb-2 text-sm text-muted">You are all caught up.</p>
          )}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => go(n)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2',
                    n.readAt === null && 'font-medium',
                  )}
                >
                  {n.readAt === null && <span className="sr-only">Unread: </span>}
                  {describe(n)}
                  <span className="block text-xs font-normal text-muted">
                    {n.projectName} · {formatDateTime(n.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
