import { useMutation } from '@tanstack/react-query';
import {
  acceptInviteRequestSchema,
  authResponseSchema,
  MIN_PASSWORD_LENGTH,
} from '@whiteboard/core';
import { Button, Field, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { AuthShell, FormError } from '../components/AuthShell';
import { api, ApiError } from '../lib/api';

type Errors = Partial<Record<'code' | 'name' | 'email' | 'password' | 'confirm', string>>;

/** A new member or freelancer joins the workspace with an invite code. */
export function JoinPage() {
  const { startSession } = useAuth();
  const [params] = useSearchParams();
  const [errors, setErrors] = useState<Errors>({});

  const join = useMutation({
    mutationFn: (body: unknown) =>
      api('/invites/accept', { method: 'POST', body, schema: authResponseSchema }),
    // The guard sends them on to Home once the session is stored.
    onSuccess: startSession,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      code: String(form.get('code') ?? ''),
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const next: Errors = {};
    const parsed = acceptInviteRequestSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors;
        next[key] ??= issue.message;
      }
    }
    if (values.password !== String(form.get('confirm') ?? ''))
      next.confirm = 'Passwords do not match';
    setErrors(next);
    if (parsed.success && !next.confirm) join.mutate(parsed.data);
  }

  let serverError: string | null = null;
  if (join.error instanceof ApiError) {
    serverError =
      join.error.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : join.error.message;
  } else if (join.error) {
    serverError = 'Something went wrong';
  }

  return (
    <AuthShell title="Join your team" subtitle="Enter the invite code you were given.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Invite code" error={errors.code}>
          <Input name="code" defaultValue={params.get('code') ?? ''} autoComplete="off" autoFocus />
        </Field>
        <Field label="Your name" error={errors.name}>
          <Input name="name" autoComplete="name" />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input name="email" type="email" autoComplete="email" />
        </Field>
        <Field
          label="Password"
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
        >
          <Input name="password" type="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <Input name="confirm" type="password" autoComplete="new-password" />
        </Field>
        <FormError message={serverError} />
        <Button type="submit" loading={join.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
