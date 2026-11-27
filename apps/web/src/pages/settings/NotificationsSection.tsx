import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MUTABLE_NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABEL,
  notificationSettingsSchema,
  type NotificationSettings,
} from '@whiteboard/core';
import { Card, Spinner } from '@whiteboard/ui';

import { FormError } from '../../components/AuthShell';
import { api, errorText } from '../../lib/api';

const KEY = ['notification-settings'];

/**
 * What lands in my bell (and, in the desktop app, as Windows notifications): one switch per kind,
 * and the daily summary. Each switch saves at once.
 */
export function NotificationsSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => api('/me/notification-settings', { schema: notificationSettingsSchema }),
  });
  const save = useMutation({
    mutationFn: (body: NotificationSettings) =>
      api('/me/notification-settings', {
        method: 'PUT',
        body,
        schema: notificationSettingsSchema,
      }),
    // The switch moves at once; if the Host refuses, the saved settings are read back.
    onMutate: (body) => queryClient.setQueryData(KEY, body),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
    onError: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  if (!settings.data) {
    return settings.isError ? <FormError message={errorText(settings.error)} /> : <Spinner />;
  }
  const current = settings.data;
  const muted = new Set(current.muted);

  return (
    <div className="flex max-w-md flex-col gap-6">
      <Card>
        <h2 className="font-semibold">Tell me when</h2>
        <p className="mt-1 text-sm text-muted">
          Turned-off kinds stay out of the bell and the Windows notifications.
        </p>
        <ul aria-label="Notification kinds" className="mt-3 flex flex-col gap-2">
          {MUTABLE_NOTIFICATION_KINDS.map((kind) => (
            <li key={kind}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!muted.has(kind)}
                  disabled={save.isPending}
                  onChange={(e) => {
                    const next = new Set(muted);
                    if (e.target.checked) next.delete(kind);
                    else next.add(kind);
                    save.mutate({ ...current, muted: [...next] });
                  }}
                />
                {NOTIFICATION_KIND_LABEL[kind]}
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-semibold">Daily summary</h2>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.dailySummary}
            disabled={save.isPending}
            onChange={(e) => save.mutate({ ...current, dailySummary: e.target.checked })}
          />
          Each morning from 08:00, one line per project: my overdue and due-today tasks, and the
          tasks waiting for my review
        </label>
      </Card>
      <FormError message={errorText(save.error)} />
    </div>
  );
}
