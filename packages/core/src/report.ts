import { z } from 'zod';

import { TASK_STATUS_KINDS } from './projects';

/** One project's numbers for the dashboard. Times are epoch milliseconds. */
export const projectReportSchema = z.object({
  generatedAt: z.number().int(),
  progress: z.object({
    /** All tasks in the project. */
    total: z.number().int(),
    /** Tasks whose status is of kind "done". */
    done: z.number().int(),
    /** Tasks not yet done (every status except "done"). */
    open: z.number().int(),
    /** Open tasks whose due date has passed. */
    overdue: z.number().int(),
    /** Open tasks due within the next seven days (not overdue). */
    dueSoon: z.number().int(),
  }),
  byStatus: z.array(
    z.object({
      statusId: z.string(),
      name: z.string(),
      kind: z.enum(TASK_STATUS_KINDS),
      count: z.number().int(),
    }),
  ),
  workload: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      open: z.number().int(),
      overdue: z.number().int(),
    }),
  ),
  /** Open tasks nobody is assigned to. */
  unassigned: z.number().int(),
  reviews: z.object({
    /** Versions submitted and still waiting for a decision. */
    waiting: z.number().int(),
    approved: z.number().int(),
    changesRequested: z.number().int(),
    /** Average hours from submission to decision, or null when nothing was decided yet. */
    averageHours: z.number().nullable(),
  }),
});
export type ProjectReport = z.infer<typeof projectReportSchema>;

export const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;
