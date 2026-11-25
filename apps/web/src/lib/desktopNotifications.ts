import { useEffect } from 'react';

import { desktopBridge } from './desktop';
import { useNotificationInbox } from './notificationInbox';
import { describeNotification } from './notificationText';
import { readStored, writeStored } from './storage';

/** How many shown notification ids to remember per person (older ones are long gone from the inbox). */
const REMEMBER = 200;

/**
 * In the desktop app, shows each new unread notification as a Windows notification, once. The ids
 * already shown are kept on this PC. The first time (nothing kept yet) the current inbox is
 * remembered without showing anything, so signing in does not replay old notifications.
 */
export function useDesktopNotifications(userId: string | undefined) {
  const bridge = desktopBridge();
  const items = useNotificationInbox(Boolean(bridge)).data?.items;

  useEffect(() => {
    if (!bridge || !items || !userId) return;
    const key = `whiteboard.desktopNotified.${userId}`;
    const saved = readStored(key);
    if (saved === null) {
      writeStored(key, JSON.stringify(items.map((n) => n.id)));
      return;
    }
    const shown = new Set<string>(JSON.parse(saved));
    const fresh = items.filter((n) => !shown.has(n.id));
    for (const n of fresh) {
      shown.add(n.id);
      if (n.readAt === null) {
        void bridge.notify(`Whiteboard · ${n.projectName}`, describeNotification(n));
      }
    }
    if (fresh.length > 0) {
      writeStored(key, JSON.stringify([...shown].slice(-REMEMBER)));
    }
  }, [bridge, items, userId]);
}
