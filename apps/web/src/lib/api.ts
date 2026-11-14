import { apiErrorSchema } from '@whiteboard/core';
import type { z } from 'zod';

import { readStored, writeStored } from './storage';

const TOKEN_KEY = 'wb.token';
const HOST_KEY = 'wb.hostUrl';

/** Bearer token for the current session. Kept in memory and mirrored to localStorage. */
let token: string | null = readStored(TOKEN_KEY);
const listeners = new Set<() => void>();

export function getToken(): string | null {
  return token;
}
export function setToken(next: string | null): void {
  token = next;
  writeStored(TOKEN_KEY, next);
  listeners.forEach((fn) => fn());
}
export function onTokenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Base URL of the Host. Empty = same origin (dev server proxy). Set by the Connect screen. */
export function getHostUrl(): string {
  return (readStored(HOST_KEY) ?? '').replace(/\/+$/, '');
}
export function setHostUrl(url: string | null): void {
  writeStored(HOST_KEY, url);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Message for the first error given (e.g. several mutations' `.error`), or `null` if none. */
export function errorText(...errors: unknown[]): string | null {
  const err = errors.find(Boolean);
  return err instanceof ApiError ? err.message : err ? 'Something went wrong' : null;
}

interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Validates the response; omit for 204 responses. */
  schema?: S;
}

/** Calls the Host. Throws `ApiError` for non-2xx and for unreachable Hosts (status 0). */
export async function api<S extends z.ZodType = z.ZodUndefined>(
  path: string,
  { method = 'GET', body, schema }: RequestOptions<S> = {},
): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${getHostUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'unreachable', 'Cannot reach the Host. Check the connection.');
  }

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
    if (res.status === 401 && token) setToken(null); // session ended
    throw new ApiError(
      res.status,
      parsed.success ? parsed.data.error : 'http_error',
      parsed.success ? parsed.data.message : `Request failed (${res.status})`,
    );
  }
  if (res.status === 204 || !schema) return undefined as z.infer<S>;
  return schema.parse(await res.json());
}
