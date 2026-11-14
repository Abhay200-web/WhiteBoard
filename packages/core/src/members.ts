import { z } from 'zod';

import { passwordSchema, sessionUserSchema } from './auth';
import { WORKSPACE_ROLES } from './roles';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Roles an invite can grant. `owner` is only ever created by `/setup`. */
export const INVITE_ROLES = ['admin', 'member', 'guest'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** Invite codes stop working after this long if unused. */
export const INVITE_TTL_DAYS = 7;

/**
 * `POST /invites` (admins). Guests (freelancers) must have an end date; others must not.
 * Only the owner may invite admins.
 */
export const createInviteRequestSchema = z
  .object({
    role: z.enum(INVITE_ROLES),
    /** Unix ms when a guest's access ends. */
    guestExpiresAt: z.number().int().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'guest' && v.guestExpiresAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['guestExpiresAt'],
        message: 'Guests need an end date',
      });
    }
    if (v.role !== 'guest' && v.guestExpiresAt !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['guestExpiresAt'],
        message: 'Only guests have an end date',
      });
    }
  });
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const inviteSchema = z.object({
  id: z.string(),
  role: z.enum(INVITE_ROLES),
  guestExpiresAt: z.number().nullable(),
  createdAt: z.number(),
  /** When the code itself stops working. */
  expiresAt: z.number(),
  createdByName: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** Returned once, when the invite is created. The code is never shown again. */
export const createdInviteSchema = inviteSchema.extend({ code: z.string() });
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

export const inviteListSchema = z.array(inviteSchema);

/** `POST /invites/accept` (public). */
export const acceptInviteRequestSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

export const memberSchema = sessionUserSchema.omit({ mustChangePassword: true }).extend({
  role: z.enum(WORKSPACE_ROLES),
  /** Guests only: when access ends. */
  expiresAt: z.number().nullable(),
  mustChangePassword: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.array(memberSchema);

/** Returned once by `POST /members/:id/reset-password`; the member must change it at next sign-in. */
export const passwordResetSchema = z.object({ temporaryPassword: z.string() });
export type PasswordReset = z.infer<typeof passwordResetSchema>;

/**
 * `GET /members/:id/open-tasks`: the member's unfinished tasks, each with the people on its
 * project who could take it over, for the remove dialog.
 */
export const openTaskSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  candidates: z.array(z.object({ userId: z.string(), name: z.string() })),
});
export type OpenTask = z.infer<typeof openTaskSchema>;
export const openTaskListSchema = z.array(openTaskSchema);

/** `POST /members/:id/remove`. Tasks not listed are left unassigned. */
export const removeMemberRequestSchema = z.object({
  reassign: z
    .array(z.object({ taskId: z.string().min(1), userId: z.string().min(1) }))
    .max(500)
    .default([]),
});

/** `PATCH /auth/me` */
export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
