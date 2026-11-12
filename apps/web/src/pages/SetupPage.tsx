import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  authResponseSchema,
  MIN_PASSWORD_LENGTH,
  setupRequestSchema,
  type SetupRequest,
} from '@whiteboard/core';
import { Button, Field, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { AuthShell, FormError } from '../components/AuthShell';
import { api, ApiError } from '../lib/api';

type Errors = Partial<Record<keyof SetupRequest | 'confirm', string>>;

/** First-run wizard: creates the workspace and its owner account on this Host. */
export function SetupPage() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Errors>({});

  const setup = useMutation({
    mutationFn: (body: SetupRequest) =>
      api('/setup', { method: 'POST', body, schema: authResponseSchema }),
    onSuccess: async (auth) => {
      startSession(auth);
      await queryClient.invalidateQueries({ queryKey: ['host-info'] });
      void navigate('/', { replace: true });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      workspaceName: String(form.get('workspaceName') ?? ''),
      ownerName: String(form.get('ownerName') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const next: Errors = {};
    const parsed = setupRequestSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SetupRequest;
        next[key] ??= issue.message;
      }
    }
    if (values.password !== String(form.get('confirm') ?? '')) {
      next.confirm = 'Passwords do not match';
    }
    setErrors(next);
    if (parsed.success && !next.confirm) setup.mutate(parsed.data);
  }

  const serverError =
    setup.error instanceof ApiError
      ? setup.error.message
      : setup.error
        ? 'Something went wrong'
        : null;

  return (
    <AuthShell
      title="Set up Whiteboard"
      subtitle="This PC will be the Host. Create your workspace and the owner account."
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Workspace name" error={errors.workspaceName} hint="Your company or studio">
          <Input name="workspaceName" autoFocus autoComplete="organization" />
        </Field>
        <Field label="Your name" error={errors.ownerName}>
          <Input name="ownerName" autoComplete="name" />
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
        <Button type="submit" loading={setup.isPending}>
          Create workspace
        </Button>
      </form>
    </AuthShell>
  );
}
