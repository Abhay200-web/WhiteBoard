import type { ProjectMemberRole, WorkspaceRole } from '@whiteboard/core';
import { projectMembers, type Db } from '@whiteboard/db';
import { and, eq } from 'drizzle-orm';

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

/** Project managers and workspace admins can edit a project and its people and files. */
export function canManageProject(db: Db, actor: Actor, projectId: string): boolean {
  return isAdmin(actor) || projectRole(db, projectId, actor.user.id) === 'manager';
}
