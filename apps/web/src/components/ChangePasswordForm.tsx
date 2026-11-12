import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePasswordRequestSchema, MIN_PASSWORD_LENGTH } from '@whiteboard/core';
import { Button, Field, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../lib/api';
import { FormError } from './AuthShell';

/** Used by the forced change screen and Settings. Other devices are signed out by the Host. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api('/auth/change-password', { method: 'POST', body }),
    onSuccess: async () => {
      setSaved(true);
      // Refresh the user so `mustChangePassword` clears.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      onDone?.();
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const values = {
      currentPassword: String(form.get('currentPassword') ?? ''),
      newPassword: String(form.get('newPassword') ?? ''),
    };
    const parsed = changePasswordRequestSchema.safeParse(values);
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Invalid input');
    if (values.newPassword !== String(form.get('confirm') ?? '')) {
      return setFieldError('New passwords do not match');
    }
    setFieldError(null);
    change.mutate(parsed.data);
  }

  const serverError = change.error instanceof ApiError ? change.error.message : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Current password">
        <Input name="currentPassword" type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
        <Input name="newPassword" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <FormError message={fieldError ?? serverError} />
      {saved && !fieldError && <p className="text-sm text-success">Password changed.</p>}
      <Button type="submit" loading={change.isPending}>
        Change password
      </Button>
    </form>
  );
}
