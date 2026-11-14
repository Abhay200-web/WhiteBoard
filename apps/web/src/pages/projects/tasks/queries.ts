import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { taskListSchema, taskSchema, taskStatusListSchema, type Task } from '@whiteboard/core';

import { api } from '../../../lib/api';

export const tasksKey = (projectId: string) => ['tasks', projectId] as const;

export const useStatuses = (projectId: string) =>
  useQuery({
    queryKey: ['statuses', projectId],
    queryFn: () => api(`/projects/${projectId}/statuses`, { schema: taskStatusListSchema }),
  });

export const useTasks = (projectId: string) =>
  useQuery({
    queryKey: tasksKey(projectId),
    queryFn: () => api(`/projects/${projectId}/tasks`, { schema: taskListSchema }),
  });

/**
 * Updates one cached task in place, so a change the Host already answered with does not
 * refetch the whole list. `change` is merged in; pass `null` to drop the task.
 */
export function patchTask(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
  change: Partial<Task> | null,
) {
  queryClient.setQueryData<Task[]>(tasksKey(projectId), (list) =>
    change === null
      ? list?.filter((t) => t.id !== taskId)
      : list?.map((t) => (t.id === taskId ? { ...t, ...change } : t)),
  );
}

type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'priority' | 'dueAt' | 'statusId'>>;

/** `PATCH /tasks/:id`, shown at once; the list rolls back if the Host refuses the change. */
export function useUpdateTask(projectId: string) {
  const queryClient = useQueryClient();
  const key = tasksKey(projectId);
  return useMutation({
    mutationFn: ({ id, ...patch }: TaskPatch & { id: string }) =>
      api(`/tasks/${id}`, { method: 'PATCH', body: patch, schema: taskSchema }),
    onMutate: async ({ id, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<Task[]>(key);
      patchTask(queryClient, projectId, id, patch);
      return { before };
    },
    onSuccess: (task) => patchTask(queryClient, projectId, task.id, task),
    onError: (_error, _patch, context) => queryClient.setQueryData(key, context?.before),
  });
}
