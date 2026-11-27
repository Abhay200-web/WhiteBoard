import { z } from 'zod';

import { TASK_PRIORITIES } from './tasks';

/**
 * A task filter: any field left out matches everything. A saved filter is one of these with a
 * name, kept per person and per project (the Host keeps it; nobody else sees it).
 */
export const taskFilterSchema = z.object({
  statusId: z.string().min(1).nullish(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  assigneeId: z.string().min(1).nullish(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

export const savedFilterSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  filter: taskFilterSchema,
  createdAt: z.number().int(),
});
export type SavedFilter = z.infer<typeof savedFilterSchema>;
export const savedFilterListSchema = z.array(savedFilterSchema);

export const createSavedFilterRequestSchema = z.object({
  name: z.string().trim().min(1, 'Give the view a name').max(60),
  filter: taskFilterSchema,
});
export type CreateSavedFilterRequest = z.input<typeof createSavedFilterRequestSchema>;
