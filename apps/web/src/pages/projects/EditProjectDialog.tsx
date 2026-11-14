import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectDetailSchema, type ProjectDetail } from '@whiteboard/core';
import { Button, Modal } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { ProjectDetailsFields, ProjectTextFields, readProjectForm } from './ProjectForm';

/** Edit a project's name, client, dates, budget, brief and instructions (managers and admins). */
export function EditProjectDialog({
  project,
  onClose,
}: {
  project: ProjectDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [brief, setBrief] = useState(project.brief);
  const [instructions, setInstructions] = useState(project.instructions);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api(`/projects/${project.id}`, { method: 'PATCH', body, schema: projectDetailSchema }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['project', project.id], updated);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = readProjectForm(event.currentTarget, brief, instructions);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form');
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <Modal title="Edit project" size="lg" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <ProjectDetailsFields project={project} />
        <ProjectTextFields project={project} onBrief={setBrief} onInstructions={setInstructions} />
        <FormError
          message={error ?? (save.error instanceof ApiError ? save.error.message : null)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
