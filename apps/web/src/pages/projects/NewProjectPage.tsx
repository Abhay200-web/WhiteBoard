import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProjectRequestSchema, projectDetailSchema, type FileInfo } from '@whiteboard/core';
import { isRichTextEmpty, RichTextEditor, type RichTextDoc } from '@whiteboard/editor';
import { Button, Card, Field, FileUploader, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { uploadFile } from '../../lib/files';
import { endOfDay, formatFileSize, startOfDay } from './format';

/** Create-project flow: name, client, dates, brief, instructions and reference files. */
export function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [brief, setBrief] = useState<RichTextDoc | null>(null);
  const [instructions, setInstructions] = useState<RichTextDoc | null>(null);
  const [uploaded, setUploaded] = useState<FileInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (body: unknown) => {
      const project = await api('/projects', {
        method: 'POST',
        body,
        schema: projectDetailSchema,
      });
      // The project exists now; attach the files best-effort so a failed one never blocks it.
      await Promise.allSettled(
        uploaded.map((file) =>
          api(`/projects/${project.id}/files`, {
            method: 'POST',
            body: { fileId: file.id, kind: 'reference' },
          }),
        ),
      );
      return project;
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/projects/${project.id}`);
    },
  });

  if (user?.role === 'guest') return <Navigate to="/projects" replace />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? '').trim();
    const start = text('startDate');
    const deadline = text('deadline');
    const budget = text('budget');
    const parsed = createProjectRequestSchema.safeParse({
      name: text('name'),
      clientName: text('clientName') || null,
      brief: isRichTextEmpty(brief) ? null : brief,
      instructions: isRichTextEmpty(instructions) ? null : instructions,
      startDate: start ? startOfDay(start) : null,
      deadline: deadline ? endOfDay(deadline) : null,
      budget: budget ? Number(budget) : null,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    setError(null);
    create.mutate(parsed.data);
  }

  return (
    <div className="max-w-2xl">
      <Link to="/projects" className="text-sm text-accent underline">
        Back to projects
      </Link>
      <h1 className="mt-2 text-xl font-semibold">New project</h1>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <Field label="Project name">
            <Input name="name" autoFocus />
          </Field>
          <Field label="Client (optional)">
            <Input name="clientName" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Start date">
              <Input name="startDate" type="date" />
            </Field>
            <Field label="Deadline">
              <Input name="deadline" type="date" />
            </Field>
            <Field label="Budget (optional)">
              <Input name="budget" type="number" min={0} />
            </Field>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="mb-1.5 text-sm font-medium">Brief</h2>
            <RichTextEditor label="Brief" onChange={setBrief} />
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-medium">Instructions</h2>
            <RichTextEditor label="Instructions" onChange={setInstructions} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-medium">Reference files</h2>
          <FileUploader
            upload={uploadFile}
            onUploaded={(info) => setUploaded((all) => [...all, info])}
          />
          {uploaded.length > 0 && (
            <ul aria-label="Files to attach" className="mt-3 text-sm text-muted">
              {uploaded.map((f) => (
                <li key={f.id}>
                  {f.name} ({formatFileSize(f.size)})
                </li>
              ))}
            </ul>
          )}
        </Card>

        <FormError
          message={error ?? (create.error instanceof ApiError ? create.error.message : null)}
        />
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>
            Create project
          </Button>
          <Link
            to="/projects"
            className="inline-flex h-9 items-center rounded-md px-4 text-sm hover:bg-surface-2"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
