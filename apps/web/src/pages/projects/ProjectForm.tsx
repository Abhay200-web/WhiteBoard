import { createProjectRequestSchema, type ProjectDetail } from '@whiteboard/core';
import { isRichTextEmpty, RichTextEditor, type RichTextDoc } from '@whiteboard/editor';
import { Button, Field, FileUploader, Input } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../components/AuthShell';
import { FileThumbnail } from '../../components/FilePreview';
import { uploadFile } from '../../lib/files';
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

/** The colours offered for a project; it shows as a strip on its card and page. */
export const PROJECT_COLORS = [
  { name: 'Blue', value: '#3366cc' },
  { name: 'Teal', value: '#1f9fa6' },
  { name: 'Green', value: '#2e9e5b' },
  { name: 'Orange', value: '#e8833a' },
  { name: 'Red', value: '#d64545' },
  { name: 'Pink', value: '#d6589a' },
  { name: 'Purple', value: '#8b5cc7' },
  { name: 'Grey', value: '#6b7280' },
];

const COVER_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

/**
 * Cover picture and colour. Both travel in the form (`coverFileId` in a hidden input), so
 * `readProjectForm` reads them like the other fields.
 */
export function ProjectLookFields({ project }: { project?: ProjectDetail }) {
  const [cover, setCover] = useState(project?.coverFileId ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const colors =
    project?.color && !PROJECT_COLORS.some((c) => c.value === project.color)
      ? [...PROJECT_COLORS, { name: 'Current colour', value: project.color }]
      : PROJECT_COLORS;

  return (
    <>
      <div>
        <h2 className="mb-1.5 text-sm font-medium">Cover picture</h2>
        <input type="hidden" name="coverFileId" value={cover ?? ''} />
        {cover && (
          <div className="mb-3 flex items-end gap-3">
            <FileThumbnail
              fileId={cover}
              name="Cover picture"
              className="h-24 w-40 rounded-md object-cover"
            />
            <Button type="button" variant="ghost" onClick={() => setCover(null)}>
              Remove cover
            </Button>
          </div>
        )}
        <FileUploader
          upload={uploadFile}
          accept={COVER_TYPES}
          multiple={false}
          onUploaded={(info) => {
            // The Host makes a thumbnail only of pictures it can read; those are the covers.
            setProblem(info.hasThumbnail ? null : 'Use a PNG, JPEG, GIF, WebP or AVIF picture.');
            if (info.hasThumbnail) setCover(info.id);
          }}
        />
        <FormError message={problem} />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap gap-2">
          <label className="flex h-8 items-center rounded-full border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
            <input
              type="radio"
              name="color"
              value=""
              defaultChecked={!project?.color}
              className="sr-only"
            />
            None
          </label>
          {colors.map((c) => (
            <label
              key={c.value}
              title={c.name}
              className="size-8 rounded-full border border-line has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:checked]:ring-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              style={{ backgroundColor: c.value }}
            >
              <input
                type="radio"
                name="color"
                value={c.value}
                aria-label={c.name}
                defaultChecked={project?.color === c.value}
                className="sr-only"
              />
            </label>
          ))}
        </div>
      </fieldset>
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
    color: text('color') || null,
    coverFileId: text('coverFileId') || null,
  });
}
