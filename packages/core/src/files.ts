import { z } from 'zod';

/** Default upload cap (2 GiB); the Host owner can change it in host settings. */
export const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** `POST /files` response and `GET /files/:id` — metadata of a stored file. */
export const fileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Detected from the file's contents, not from the name the client sent. */
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  hasThumbnail: z.boolean(),
  uploadedBy: z.string(),
  createdAt: z.number().int(),
});
export type FileInfo = z.infer<typeof fileSchema>;
