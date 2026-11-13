import { z } from 'zod';

export const backupManifestSchema = z.object({
  name: z.string(),
  kind: z.enum(['daily', 'manual', 'pre-migration']),
  createdAt: z.number().int(),
  serverVersion: z.string(),
});
export type BackupInfo = z.infer<typeof backupManifestSchema>;

/** `GET /backups` — owner only. */
export const backupStatusSchema = z.object({
  backupDir: z.string(),
  lastBackupAt: z.number().int().nullable(),
  /** No backup yet, or the last one is older than 36 hours. */
  stale: z.boolean(),
  freeBytes: z.number().nullable(),
  backups: z.array(backupManifestSchema),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

/** `GET/PATCH /host/settings` — owner only. */
export const hostSettingsSchema = z.object({
  /** Where backups are written (default: `<data folder>/backups`). */
  backupDir: z.string(),
  maxUploadBytes: z.number().int().positive(),
});
export type HostSettings = z.infer<typeof hostSettingsSchema>;

export const updateHostSettingsSchema = z
  .object({
    backupDir: z.string().trim().min(1).max(500),
    maxUploadBytes: z
      .number()
      .int()
      .min(1024 * 1024, 'At least 1 MB')
      .max(100 * 1024 * 1024 * 1024, 'At most 100 GB'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateHostSettings = z.infer<typeof updateHostSettingsSchema>;
