import { useQuery } from '@tanstack/react-query';
import {
  isAdminRole,
  projectDetailSchema,
  type ProjectDetail,
  type SessionUser,
} from '@whiteboard/core';

import { api } from '../../lib/api';

/** One project's details. The same cache entry serves the project page and task drawers. */
export const useProject = (id: string) =>
  useQuery({
    queryKey: ['project', id],
    queryFn: () => api(`/projects/${id}`, { schema: projectDetailSchema }),
    retry: false,
  });

/** Managers of the project and workspace admins may edit it and its tasks (the Host checks too). */
export const canManageProject = (
  user: SessionUser | null | undefined,
  project: ProjectDetail,
): boolean => isAdminRole(user?.role) || project.myRole === 'manager';
