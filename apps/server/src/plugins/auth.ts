import type { ApiError, WorkspaceRole } from '@whiteboard/core';
import type { Db } from '@whiteboard/db';
import type { FastifyReply, preHandlerAsyncHookHandler } from 'fastify';

import { resolveSession, type AuthContext } from '../auth/sessions';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const ALL_ROLES = [
  'owner',
  'admin',
  'member',
  'guest',
] as const satisfies readonly WorkspaceRole[];
/** Workspace administrators. */
export const ADMIN_ROLES = ['owner', 'admin'] as const satisfies readonly WorkspaceRole[];

export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.code(status).send(body);
}

/** 400 with the first validation message, or a generic one. */
export function badRequest(reply: FastifyReply, message?: string) {
  return sendError(reply, 400, 'invalid_request', message ?? 'Invalid request');
}

/** Pre-handler: requires a valid bearer session and attaches `request.auth`. */
export function authenticate(db: Db): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const auth = token ? resolveSession(db, token) : null;
    if (!auth) return sendError(reply, 401, 'unauthorized', 'Sign in required');
    request.auth = auth;
  };
}

/**
 * Pre-handler factory: the signed-in user must hold one of `roles`. Use after `authenticate`.
 * Users who must change their password are blocked unless the route opts out
 * with `allowPasswordChangePending` (only the auth routes do).
 */
export function requireRole(
  roles: readonly WorkspaceRole[],
  opts: { allowPasswordChangePending?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const auth = request.auth;
    if (!auth) return sendError(reply, 401, 'unauthorized', 'Sign in required');
    if (auth.user.mustChangePassword && !opts.allowPasswordChangePending) {
      return sendError(reply, 403, 'password_change_required', 'Change your password first');
    }
    if (!roles.includes(auth.user.role)) {
      return sendError(reply, 403, 'forbidden', 'You do not have access to this');
    }
  };
}
