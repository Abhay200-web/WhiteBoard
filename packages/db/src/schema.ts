// SQLite schema (spec §6). Timestamps are integer ms, ids are text (ULID).
import { WORKSPACE_ROLES } from '@whiteboard/core';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
