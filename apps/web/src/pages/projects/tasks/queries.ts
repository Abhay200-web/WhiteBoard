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

type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'priority' | 'dueAt' | 'statusId' | 'sortKey'>
>;

/**
 * `PATCH /tasks/:id`, shown at once. If the Host refuses, only the fields this change touched
 * on this task go back, so other changes made meanwhile (another card dragged) are kept.
 */
export function useUpdateTask(projectId: string) {
  const queryClient = useQueryClient();
  const key = tasksKey(projectId);
  return useMutation({
    mutationFn: ({ id, ...patch }: TaskPatch & { id: string }) =>
      api(`/tasks/${id}`, { method: 'PATCH', body: patch, schema: taskSchema }),
    onMutate: async ({ id, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<Task[]>(key)?.find((t) => t.id === id);
      patchTask(queryClient, projectId, id, patch);
      const undo =
        before && Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Task]]));
      return { undo: undo as Partial<Task> | undefined };
    },
    onSuccess: (task, { sortKey }) => {
      patchTask(queryClient, projectId, task.id, task);
      // The Host renumbered the column (a drop left no gap): fetch everyone's new positions.
      if (sortKey !== undefined && task.sortKey !== sortKey) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (_error, { id }, context) => {
      if (context?.undo) patchTask(queryClient, projectId, id, context.undo);
    },
  });
}
