/** Workspace-level roles (spec §6). Staff are `member`, freelancers are `guest`. */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Owners and admins run the workspace: every project, the members, the Host. */
export const isAdminRole = (role: WorkspaceRole | undefined): boolean =>
  role === 'owner' || role === 'admin';
