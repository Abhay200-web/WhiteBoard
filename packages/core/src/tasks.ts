import { z } from 'zod';

import {
  projectFileSchema,
  richTextSchema,
  TASK_STATUS_KINDS,
  type TaskStatusKind,
} from './projects';

/** Gap between sort keys (Host and web), so a card can later be dropped between two others. */
export const SORT_STEP = 1000;

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The only moves an assignee (artist) may make. Everything else needs a manager or admin. */
const ASSIGNEE_MOVES: Partial<Record<TaskStatusKind, readonly TaskStatusKind[]>> = {
  todo: ['doing'],
  doing: ['todo'],
  changes: ['doing'],
};

/**
 * Whether a task may move between two status kinds. Nobody moves a task into review by hand:
 * "Submit for review" (Part 5) does that, so approval always follows a real submission.
 * The Host enforces this; the web app uses it to offer only the allowed moves.
 */
export function canMoveTask(from: TaskStatusKind, to: TaskStatusKind, isManager: boolean): boolean {
  if (from === to) return true;
  if (to === 'review') return false;
  return isManager || (ASSIGNEE_MOVES[from]?.includes(to) ?? false);
}

/** A column of a project's task board (`GET /projects/:id/statuses`). */
export const taskStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(TASK_STATUS_KINDS),
  sortKey: z.number().int(),
});
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const taskStatusListSchema = z.array(taskStatusSchema);

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  statusId: z.string(),
  title: z.string(),
  description: richTextSchema.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  startAt: z.number().int().nullable(),
  dueAt: z.number().int().nullable(),
  /** Order inside its status column, ascending. */
  sortKey: z.number().int(),
  createdBy: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  assignees: z.array(z.object({ userId: z.string(), name: z.string() })),
  subtaskCounts: z.object({ done: z.number().int(), total: z.number().int() }),
  fileCount: z.number().int(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.array(taskSchema);

/**
 * `GET /me/tasks` and `GET /me/review-queue`: tasks from several projects, each with the names
 * of its project and status so a list can show them without more requests.
 */
export const myTaskSchema = taskSchema.extend({ projectName: z.string(), statusName: z.string() });
export type MyTask = z.infer<typeof myTaskSchema>;
export const myTaskListSchema = z.array(myTaskSchema);

const datesInOrder = (v: { startAt?: number | null; dueAt?: number | null }) =>
  v.startAt == null || v.dueAt == null || v.dueAt >= v.startAt;
const DATES_MESSAGE = 'The due date cannot be before the start date';

const taskFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: richTextSchema.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  startAt: z.number().int().nullable(),
  dueAt: z.number().int().nullable(),
  statusId: z.string().min(1),
  sortKey: z.number().int(),
};

/** `POST /projects/:id/tasks`. Without `statusId` the task starts in the project's "To do" column. */
export const createTaskRequestSchema = z
  .object({ title: taskFields.title })
  .extend({
    description: taskFields.description.optional(),
    priority: taskFields.priority.default('medium'),
    startAt: taskFields.startAt.optional(),
    dueAt: taskFields.dueAt.optional(),
    statusId: taskFields.statusId.optional(),
    assigneeIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .refine(datesInOrder, DATES_MESSAGE);

/** `PATCH /tasks/:id`. Artists may only send `statusId` and `sortKey`, on tasks assigned to them. */
export const updateTaskRequestSchema = z
  .object(taskFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change')
  .refine(datesInOrder, DATES_MESSAGE);

/** `PUT /tasks/:id/assignees` replaces the whole list. */
export const setAssigneesRequestSchema = z.object({
  userIds: z.array(z.string().min(1)).max(50),
});

export const subtaskSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string(),
  done: z.boolean(),
  sortKey: z.number().int(),
});
export type Subtask = z.infer<typeof subtaskSchema>;
export const subtaskListSchema = z.array(subtaskSchema);

export const createSubtaskRequestSchema = z.object({ title: taskFields.title });
/** Managers may rename, reorder or tick; assignees may only tick (`done`). */
export const updateSubtaskRequestSchema = z
  .object({ title: taskFields.title, done: z.boolean(), sortKey: z.number().int() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

/**
 * A file attached to a task or a project, as file lists show it: a project file without the
 * project-only `kind`. `GET /tasks/:id/files` returns these; the web reads both lists this way.
 */
export const attachedFileSchema = projectFileSchema.omit({ kind: true });
export type AttachedFile = z.infer<typeof attachedFileSchema>;
export const attachedFileListSchema = z.array(attachedFileSchema);

export const attachTaskFileRequestSchema = z.object({ fileId: z.string().min(1) });

// --- deliverables --------------------------------------------------------------------------

/** Review state of one version: waiting for a manager, changes asked for, or approved. */
export const DELIVERABLE_STATES = ['pending', 'changes', 'approved'] as const;
export type DeliverableState = (typeof DELIVERABLE_STATES)[number];

/** A manager's decision on a version. */
export const REVIEW_DECISIONS = ['approve', 'changes'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const deliverableVersionSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  fileId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  note: z.string().nullable(),
  state: z.enum(DELIVERABLE_STATES),
  submittedBy: z.string(),
  submittedAt: z.number().int(),
  /** The manager's decision and summary, once there is one. */
  review: z
    .object({
      decision: z.enum(REVIEW_DECISIONS),
      reviewerName: z.string(),
      summary: z.string().nullable(),
      at: z.number().int(),
    })
    .nullable(),
});
export type DeliverableVersion = z.infer<typeof deliverableVersionSchema>;

/** `GET /tasks/:id/deliverables`: each deliverable with its versions, oldest first. */
export const deliverableSchema = z.object({
  id: z.string(),
  name: z.string(),
  versions: z.array(deliverableVersionSchema),
});
export type Deliverable = z.infer<typeof deliverableSchema>;
export const deliverableListSchema = z.array(deliverableSchema);

export const createDeliverableRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name the deliverable').max(120),
});

/** `POST /deliverables/:id/versions`: the uploaded file and an optional note for the manager. */
export const submitVersionRequestSchema = z.object({
  fileId: z.string().min(1),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => s || null)
    .nullable()
    .optional(),
});

/**
 * `POST /versions/:id/reviews`. Asking for changes must say what to fix; approval may have a note.
 * The Host enforces the same rule.
 */
export const reviewRequestSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    summary: z
      .string()
      .trim()
      .max(2000)
      .transform((s) => s || null)
      .nullable()
      .optional(),
  })
  .refine((v) => v.decision === 'approve' || v.summary, {
    message: 'Say what needs to change',
    path: ['summary'],
  });

/** `GET /versions/compare?a=&b=`: two versions, which must be of the same deliverable. */
export const compareQuerySchema = z.object({ a: z.string().min(1), b: z.string().min(1) });
export const versionCompareSchema = z.object({
  deliverable: z.string(),
  a: deliverableVersionSchema,
  b: deliverableVersionSchema,
});
export type VersionCompare = z.infer<typeof versionCompareSchema>;

// --- pins ----------------------------------------------------------------------------------

/** A pin is open until someone resolves it. */
export const PIN_STATES = ['open', 'resolved'] as const;
export type PinState = (typeof PIN_STATES)[number];

/** A numbered pin on one page of a version's preview. `x` and `y` are 0–1 of that page. */
export const pinSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  number: z.number().int(),
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  state: z.enum(PIN_STATES),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.number().int(),
});
export type Pin = z.infer<typeof pinSchema>;
export const pinListSchema = z.array(pinSchema);

/** `POST /versions/:id/pins`: where the click landed. */
export const pinRequestSchema = z.object({
  page: z.number().int().min(1).max(10000),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** `PATCH /pins/:id`: resolve or reopen. */
export const pinStateRequestSchema = z.object({ state: z.enum(PIN_STATES) });

export const pinCommentSchema = z.object({
  id: z.string(),
  pinId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.number().int(),
});
export type PinComment = z.infer<typeof pinCommentSchema>;
export const pinCommentListSchema = z.array(pinCommentSchema);

/** `POST /pins/:id/comments`: one message in a pin's thread. */
export const pinCommentRequestSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
});

// --- comments ------------------------------------------------------------------------------

/** A task comment: plain text. `mentions` are the user ids @-mentioned in it (project members). */
export const commentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  mentions: z.array(z.string()),
  createdAt: z.number().int(),
  editedAt: z.number().int().nullable(),
});
export type Comment = z.infer<typeof commentSchema>;
export const commentListSchema = z.array(commentSchema);

/**
 * `POST /tasks/:id/comments` and `PATCH /comments/:id`. The web sends the ids of the people it
 * offered for @-mention; the Host keeps only those still on the project.
 */
export const commentRequestSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000),
  mentionIds: z.array(z.string().min(1)).max(50).default([]),
});

// --- history -------------------------------------------------------------------------------

/** What happened to a task. Names are kept as they were then, so old entries still read right. */
export const taskEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('created') }),
  z.object({ event: z.literal('status'), from: z.string(), to: z.string() }),
  z.object({
    event: z.literal('assignees'),
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
  z.object({
    event: z.literal('priority'),
    from: z.enum(TASK_PRIORITIES),
    to: z.enum(TASK_PRIORITIES),
  }),
  z.object({
    event: z.literal('due'),
    from: z.number().int().nullable(),
    to: z.number().int().nullable(),
  }),
  z.object({ event: z.literal('file'), name: z.string(), added: z.boolean() }),
  /** An artist sent version `number` of the deliverable `name` for review. */
  z.object({ event: z.literal('submitted'), name: z.string(), number: z.number().int() }),
  /** A manager approved version `number` of `name`, or asked for changes on it. */
  z.object({
    event: z.literal('reviewed'),
    name: z.string(),
    number: z.number().int(),
    decision: z.enum(REVIEW_DECISIONS),
  }),
  z.object({ event: z.literal('comment') }),
  /**
   * The assignee `name` left the workspace. `to`: who took the task over (null: unassigned).
   * `auto`: their freelancer access ran out (the actor is then the person who left).
   */
  z.object({
    event: z.literal('left'),
    name: z.string(),
    to: z.string().nullable(),
    auto: z.boolean(),
  }),
]);
export type TaskEvent = z.infer<typeof taskEventSchema>;

/** `GET /tasks/:id/history`, oldest first. */
export const taskHistoryEntrySchema = taskEventSchema.and(
  z.object({ id: z.string(), actorName: z.string(), at: z.number().int() }),
);
export type TaskHistoryEntry = z.infer<typeof taskHistoryEntrySchema>;
export const taskHistorySchema = z.array(taskHistoryEntrySchema);
