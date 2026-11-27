// SQLite schema (spec §6). Timestamps are integer ms, ids are text (ULID).
import {
  DEADLINE_ALERT_KINDS,
  DELIVERABLE_STATES,
  NOTIFICATION_KINDS,
  PIN_STATES,
  PROJECT_FILE_KINDS,
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  REVIEW_DECISIONS,
  TASK_PRIORITIES,
  TASK_STATUS_KINDS,
  WORKSPACE_ROLES,
} from '@whiteboard/core';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Exactly one row per Host. */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const memberships = sqliteTable(
  'memberships',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: WORKSPACE_ROLES }).notNull(),
    /** Guests (freelancers) only; access ends automatically. */
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    /** Offboarding is a soft delete so history is kept. */
    removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
    removedBy: text('removed_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/** Backup folder & schedule, max upload size, app version. */
export const hostSettings = sqliteTable('host_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/** Password hashes live apart from `users` so user rows are safe to serialise. */
export const credentials = sqliteTable('credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  /** `scrypt$<salt>$<hash>` (see server auth/password.ts). */
  passwordHash: text('password_hash').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Bearer sessions. Only the SHA-256 of the token is stored. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** One-time invite codes. Only the SHA-256 of the code is stored. */
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  codeHash: text('code_hash').notNull().unique(),
  role: text('role', { enum: ['admin', 'member', 'guest'] as const }).notNull(),
  guestExpiresAt: integer('guest_expires_at', { mode: 'timestamp_ms' }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** The code stops working at this time. */
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  usedBy: text('used_by').references(() => users.id),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

/**
 * Every uploaded file. Bytes live on disk under `<dataDir>/files/`; `storagePath` is relative to
 * that folder. Which project a file belongs to comes later (`project_files`).
 */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('files_sha256_idx').on(t.sha256)],
);

/** A creative project. `brief` and `instructions` are TipTap (ProseMirror) JSON. */
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    clientName: text('client_name'),
    brief: text('brief', { mode: 'json' }),
    instructions: text('instructions', { mode: 'json' }),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('draft'),
    startDate: integer('start_date', { mode: 'timestamp_ms' }),
    deadline: integer('deadline', { mode: 'timestamp_ms' }),
    /** Whole currency units; optional. */
    budget: integer('budget'),
    color: text('color'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('projects_workspace_idx').on(t.workspaceId)],
);

/** Project-level role (manager | artist), separate from the workspace role. */
export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: PROJECT_MEMBER_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_idx').on(t.userId),
  ],
);

/** Task columns of a project; seeded with six defaults (one per kind). */
export const taskStatuses = sqliteTable(
  'task_statuses',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: TASK_STATUS_KINDS }).notNull(),
    sortKey: integer('sort_key').notNull(),
  },
  (t) => [index('task_statuses_project_idx').on(t.projectId)],
);

/** Files attached to a project. Only project members (and admins) can read them. */
export const projectFiles = sqliteTable(
  'project_files',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    kind: text('kind', { enum: PROJECT_FILE_KINDS }).notNull(),
    addedBy: text('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.fileId] }),
    index('project_files_file_idx').on(t.fileId),
  ],
);

/** A unit of work in a project. `description` is TipTap JSON; `sortKey` orders it in its column. */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    statusId: text('status_id')
      .notNull()
      .references(() => taskStatuses.id),
    title: text('title').notNull(),
    description: text('description', { mode: 'json' }),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('medium'),
    startAt: integer('start_at', { mode: 'timestamp_ms' }),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    sortKey: integer('sort_key').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('tasks_project_idx').on(t.projectId, t.statusId, t.sortKey)],
);

export const taskAssignees = sqliteTable(
  'task_assignees',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index('task_assignees_user_idx').on(t.userId),
  ],
);

/** Checklist items inside a task. */
export const subtasks = sqliteTable(
  'subtasks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    sortKey: integer('sort_key').notNull(),
  },
  (t) => [index('subtasks_task_idx').on(t.taskId)],
);

/** Already-uploaded files attached to a task. Members of the task's project can read them. */
export const taskFiles = sqliteTable(
  'task_files',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    addedBy: text('added_by')
      .notNull()
      .references(() => users.id),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.fileId] }), index('task_files_file_idx').on(t.fileId)],
);

/** What an artist delivers on a task (e.g. "Poster"). Each new file sent for it is a version. */
export const deliverables = sqliteTable(
  'deliverables',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('deliverables_task_idx').on(t.taskId)],
);

/** One submitted file of a deliverable. `number` counts 1, 2, 3 per deliverable. */
export const deliverableVersions = sqliteTable(
  'deliverable_versions',
  {
    id: text('id').primaryKey(),
    deliverableId: text('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    note: text('note'),
    state: text('state', { enum: DELIVERABLE_STATES }).notNull().default('pending'),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('deliverable_versions_number_idx').on(t.deliverableId, t.number)],
);

/** A manager's decision on one version. A version gets at most one (it leaves "pending" with it). */
export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => deliverableVersions.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision', { enum: REVIEW_DECISIONS }).notNull(),
    summary: text('summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('reviews_version_idx').on(t.versionId)],
);

/** A numbered pin on one page of a version's preview. `number` counts 1, 2, 3 per version. */
export const pins = sqliteTable(
  'pins',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => deliverableVersions.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    page: integer('page').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    state: text('state', { enum: PIN_STATES }).notNull().default('open'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('pins_version_number_idx').on(t.versionId, t.number)],
);

/** One message in a pin's thread. */
export const pinComments = sqliteTable(
  'pin_comments',
  {
    id: text('id').primaryKey(),
    pinId: text('pin_id')
      .notNull()
      .references(() => pins.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('pin_comments_pin_idx').on(t.pinId, t.createdAt)],
);

/** Comments on a task (plain text). `mentions` is a JSON array of @-mentioned user ids. */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    mentions: text('mentions', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('comments_task_idx').on(t.taskId, t.createdAt)],
);

/**
 * A task's audit trail: one row per change, written in the same transaction as the change.
 * `event` + `data` together are a `TaskEvent` (packages/core), checked when read.
 */
export const taskHistory = sqliteTable(
  'task_history',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    event: text('event').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('task_history_task_idx').on(t.taskId, t.at)],
);

/**
 * The bell: one row per person told about something. Names (task, project, actor) are joined
 * when read; `detail` keeps the status name or comment excerpt as it was then.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Who did it; null for the Host's own alerts. */
    actorId: text('actor_id').references(() => users.id),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    detail: text('detail'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/**
 * Deadline alerts already sent, so each is sent once. Keyed by the due date too: moving a task's
 * due date sends its alerts again.
 */
export const deadlineAlerts = sqliteTable(
  'deadline_alerts',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DEADLINE_ALERT_KINDS }).notNull(),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.kind, t.dueAt] })],
);

/** Last run of each scheduled job, so missed runs are caught up after Host downtime. */
export const jobs = sqliteTable('jobs', {
  name: text('name').primaryKey(),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status', { enum: ['ok', 'error'] as const }),
  lastError: text('last_error'),
});

/** A board: one root board per project, and boards nested inside others (Phase B). */
export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    isRoot: integer('is_root', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    trashedAt: integer('trashed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('boards_project_idx').on(t.projectId),
    // At most one root board per project.
    uniqueIndex('boards_one_root_idx')
      .on(t.projectId)
      .where(sql`is_root = 1`),
  ],
);

/**
 * Things placed on a board. Kind `board` puts a child board on its parent, which is how boards
 * nest (a child board has exactly one row here). Cards (notes, files, ...) are added in Step B4.
 */
export const boardItems = sqliteTable(
  'board_items',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['board'] as const }).notNull(),
    childBoardId: text('child_board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    x: real('x').notNull(),
    y: real('y').notNull(),
    width: real('width').notNull(),
    height: real('height').notNull(),
  },
  (t) => [
    index('board_items_board_idx').on(t.boardId),
    uniqueIndex('board_items_child_idx').on(t.childBoardId),
  ],
);
