import { useQuery } from '@tanstack/react-query';
import { notificationInboxSchema } from '@whiteboard/core';

import { api } from './api';

/** The notification inbox: the bell and the desktop notifier share it (one request, one cache entry). */
export function useNotificationInbox(enabled = true) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications', { schema: notificationInboxSchema }),
    enabled,
  });
}
