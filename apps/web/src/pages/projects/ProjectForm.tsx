import { createProjectRequestSchema, type ProjectDetail } from '@whiteboard/core';
import { isRichTextEmpty, RichTextEditor, type RichTextDoc } from '@whiteboard/editor';
import { Field, Input } from '@whiteboard/ui';

import { endOfDay, startOfDay, toDateInput } from './format';

// Shared by the create page and the edit dialog, so both send the same fields the same way.

/** Name, client, dates and budget. Pass `project` to prefill them for editing. */
export function ProjectDetailsFields({ project }: { project?: ProjectDetail }) {
  return (
    <>
      <Field label="Project name">
        <Input name="name" autoFocus defaultValue={project?.name} />
      </Field>
      <Field label="Client (optional)">
        <Input name="clientName" defaultValue={project?.clientName ?? ''} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Start date">
          <Input name="startDate" type="date" defaultValue={toDateInput(project?.startDate)} />
        </Field>
        <Field label="Deadline">
          <Input name="deadline" type="date" defaultValue={toDateInput(project?.deadline)} />
        </Field>
        <Field label="Budget (optional)">
          <Input name="budget" type="number" min={0} defaultValue={project?.budget ?? ''} />
        </Field>
      </div>
    </>
  );
}

/** Brief and instructions editors. The editors own their text; changes come back via the setters. */
export function ProjectTextFields({
  project,
  onBrief,
  onInstructions,
}: {
  project?: ProjectDetail;
  onBrief: (doc: RichTextDoc) => void;
  onInstructions: (doc: RichTextDoc) => void;
}) {
  return (
    <>
      <div>
        <h2 className="mb-1.5 text-sm font-medium">Brief</h2>
        <RichTextEditor label="Brief" value={project?.brief} onChange={onBrief} />
      </div>
      <div>
        <h2 className="mb-1.5 text-sm font-medium">Instructions</h2>
        <RichTextEditor
          label="Instructions"
          value={project?.instructions}
          onChange={onInstructions}
        />
      </div>
    </>
  );
}

/** Reads the form into a validated request. Empty inputs become `null`, which clears them. */
export function readProjectForm(
  form: HTMLFormElement,
  brief: RichTextDoc | null,
  instructions: RichTextDoc | null,
) {
  const data = new FormData(form);
  const text = (key: string) => String(data.get(key) ?? '').trim();
  const start = text('startDate');
  const deadline = text('deadline');
  const budget = text('budget');
  return createProjectRequestSchema.safeParse({
    name: text('name'),
    clientName: text('clientName') || null,
    brief: isRichTextEmpty(brief) ? null : brief,
    instructions: isRichTextEmpty(instructions) ? null : instructions,
    startDate: start ? startOfDay(start) : null,
    deadline: deadline ? endOfDay(deadline) : null,
    budget: budget ? Number(budget) : null,
  });
}
