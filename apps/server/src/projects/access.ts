import type { ProjectMemberRole, WorkspaceRole } from '@whiteboard/core';
import { memberships, projectMembers, projects, type Db, type DbTx } from '@whiteboard/db';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import { ADMIN_ROLES } from '../plugins/auth';

export interface Actor {
  user: { id: string; role: WorkspaceRole };
}

export const isAdmin = (actor: Actor): boolean =>
  ADMIN_ROLES.some((role) => role === actor.user.role);

/** The user's role in the project, or `null` if they are not a member. */
export function projectRole(db: Db, projectId: string, userId: string): ProjectMemberRole | null {
  return (
    db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .get()?.role ?? null
  );
}

/** Admins see every project; everyone else only the projects they belong to. */
export function canViewProject(db: Db, actor: Actor, projectId: string): boolean {
  return isAdmin(actor) || projectRole(db, projectId, actor.user.id) !== null;
}

/**
 * Which of `userIds` can see the project right now: its members and the workspace admins, in
 * both cases with workspace access that is not removed or expired. `canViewProject` answers the
 * same question for the signed-in caller; this one is for telling other people about it.
 */
export function projectViewers(db: Db | DbTx, projectId: string, userIds: string[]): string[] {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  return db
    .select({ userId: memberships.userId, role: memberships.role, member: projectMembers.userId })
    .from(memberships)
    .innerJoin(
      projects,
      and(eq(projects.id, projectId), eq(projects.workspaceId, memberships.workspaceId)),
    )
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberships.userId)),
    )
    .where(
      and(
        inArray(memberships.userId, unique),
        isNull(memberships.removedAt),
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, new Date())),
      ),
    )
    .all()
    .filter((r) => r.member !== null || ADMIN_ROLES.some((role) => role === r.role))
    .map((r) => r.userId);
}

/** Project managers and workspace admins can edit a project and its people and files. */
export function canManageProject(db: Db, actor: Actor, projectId: string): boolean {
  return isAdmin(actor) || projectRole(db, projectId, actor.user.id) === 'manager';
}
