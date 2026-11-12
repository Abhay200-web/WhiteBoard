import { z } from 'zod';

import { WORKSPACE_ROLES } from './roles';

/** Minimum password length for every account (spec §12). */
export const MIN_PASSWORD_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** The signed-in user as seen by the client. */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(WORKSPACE_ROLES),
  /** When true the client must force the change-password screen. */
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** `POST /setup` — allowed exactly once per Host; creates the workspace and its owner. */
export const setupRequestSchema = z.object({
  workspaceName: z.string().trim().min(1).max(100),
  ownerName: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

/** `POST /auth/sign-in` */
export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

/** Returned by `/setup` and `/auth/sign-in`. The token is sent as `Authorization: Bearer <token>`. */
export const authResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.number().int().describe('Unix ms'),
  user: sessionUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** `POST /auth/change-password` */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Error body used by every non-2xx response. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
