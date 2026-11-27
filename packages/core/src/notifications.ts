import { z } from 'zod';

/**
 * Alerts the Host sends about due dates, with no actor: "due soon" (within 24 hours) and "overdue"
 * (past the due date, not done).
 */
export const DEADLINE_ALERT_KINDS = ['due_soon', 'overdue'] as const;
export type DeadlineAlertKind = (typeof DEADLINE_ALERT_KINDS)[number];

export const NOTIFICATION_KINDS = [
  'assigned',
  'mentioned',
  'commented',
  'status',
  'added_to_project',
  /** To project managers: the actor's freelancer access ran out; their task is unassigned. */
  'access_ended',
  ...DEADLINE_ALERT_KINDS,
  /** Once a day, per project: my overdue and due-today tasks, and reviews waiting for me. */
  'daily_summary',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The kinds a person can turn off. The daily summary has its own on/off switch. */
export const MUTABLE_NOTIFICATION_KINDS = NOTIFICATION_KINDS.filter(
  (k): k is Exclude<NotificationKind, 'daily_summary'> => k !== 'daily_summary',
);
export type MutableNotificationKind = (typeof MUTABLE_NOTIFICATION_KINDS)[number];

/** What each switch on the settings page says. */
export const NOTIFICATION_KIND_LABEL: Record<MutableNotificationKind, string> = {
  assigned: 'Someone assigns me a task',
  mentioned: 'Someone mentions me in a comment',
  commented: 'Someone comments on my tasks',
  status: 'My tasks move to another status',
  added_to_project: 'Someone adds me to a project',
  access_ended: "A freelancer's access ends (project managers)",
  due_soon: 'My tasks are due within 24 hours',
  overdue: 'My tasks are overdue',
};

/** `GET` and `PUT /me/notification-settings`. By default everything is on and the summary off. */
export const notificationSettingsSchema = z.object({
  /** The kinds this person does not want in the bell (or as Windows notifications). */
  muted: z.array(z.enum(MUTABLE_NOTIFICATION_KINDS)).max(MUTABLE_NOTIFICATION_KINDS.length),
  dailySummary: z.boolean(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** One line in the bell. `detail` is the new status name or the start of the comment. */
export const notificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** Null for the Host's own alerts (due soon, overdue). */
  actorName: z.string().nullable(),
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
  /** Something about this task changed; apps showing it reload it. Ids only, no content. */
  z.object({ type: z.literal('task.changed'), projectId: z.string(), taskId: z.string() }),
  /** A manager added, renamed, reordered or deleted this project's statuses. */
  z.object({ type: z.literal('statuses.changed'), projectId: z.string() }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
