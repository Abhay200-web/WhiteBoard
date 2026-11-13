// SQLite schema (spec §6). Timestamps are integer ms, ids are text (ULID).
import { WORKSPACE_ROLES } from '@whiteboard/core';
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

/** Last run of each scheduled job, so missed runs are caught up after Host downtime. */
export const jobs = sqliteTable('jobs', {
  name: text('name').primaryKey(),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status', { enum: ['ok', 'error'] as const }),
  lastError: text('last_error'),
});
