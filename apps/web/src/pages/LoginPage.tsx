import { useMutation } from '@tanstack/react-query';
import { authResponseSchema, type SignInRequest } from '@whiteboard/core';
import { Button, Field, Input } from '@whiteboard/ui';
import type { FormEvent } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useHostInfo } from '../auth/guards';
import { AuthShell, FormError } from '../components/AuthShell';
import { api, ApiError } from '../lib/api';

export function LoginPage() {
  const { startSession } = useAuth();
  const host = useHostInfo();

  const signIn = useMutation({
    mutationFn: (body: SignInRequest) =>
      api('/auth/sign-in', { method: 'POST', body, schema: authResponseSchema }),
    // The guard redirects to "/" (or the forced password change) once the session is stored.
    onSuccess: startSession,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    signIn.mutate({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });
  }

  let error: string | null = null;
  if (signIn.error instanceof ApiError) {
    error =
      signIn.error.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : signIn.error.message;
  } else if (signIn.error) {
    error = 'Something went wrong';
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle={host.data?.workspaceName ? `to ${host.data.workspaceName}` : undefined}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input name="email" type="email" required autoFocus autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
        <FormError message={error} />
        <Button type="submit" loading={signIn.isPending}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
