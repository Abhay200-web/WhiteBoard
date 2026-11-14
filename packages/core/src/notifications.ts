import { z } from 'zod';

export const NOTIFICATION_KINDS = [
  'assigned',
  'mentioned',
  'commented',
  'status',
  'added_to_project',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One line in the bell. `detail` is the new status name or the start of the comment. */
export const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  actorName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.number().int(),
  readAt: z.number().int().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** `GET /notifications`: the latest ones, and how many are unread in all. */
export const notificationInboxSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(),
});
export type NotificationInbox = z.infer<typeof notificationInboxSchema>;

/** `POST /notifications/read`: the given ones, or all of mine when `ids` is left out. */
export const markReadRequestSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
});

/** Messages on the live `/events` connection. The client sends `auth` first. */
export const clientEventSchema = z.object({ type: z.literal('auth'), token: z.string().min(1) });
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('notification') }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
