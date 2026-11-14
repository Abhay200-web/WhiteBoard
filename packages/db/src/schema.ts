// SQLite schema (spec §6). Timestamps are integer ms, ids are text (ULID).
import {
  PROJECT_FILE_KINDS,
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUS_KINDS,
  WORKSPACE_ROLES,
} from '@whiteboard/core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/** Last run of each scheduled job, so missed runs are caught up after Host downtime. */
export const jobs = sqliteTable('jobs', {
  name: text('name').primaryKey(),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status', { enum: ['ok', 'error'] as const }),
  lastError: text('last_error'),
});
