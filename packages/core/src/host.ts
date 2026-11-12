import { z } from 'zod';

/** `GET /host/info` — public; used by Host discovery and the version check (spec §8). */
export const hostInfoSchema = z.object({
  /** `null` until `/setup` has created the workspace. */
  workspaceName: z.string().nullable(),
  serverVersion: z.string(),
  setupDone: z.boolean(),
});
export type HostInfo = z.infer<typeof hostInfoSchema>;
