import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deliverableListSchema, deliverableSchema, type DeliverableState } from '@whiteboard/core';
import { Field, FileUploader, Input, Select, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../../components/AuthShell';
import { api, errorText } from '../../../lib/api';
import { uploadFile } from '../../../lib/files';
import { formatDateTime, formatFileSize } from '../format';
import { tasksKey } from './queries';

const STATE_LABEL: Record<DeliverableState, string> = {
  pending: 'Waiting for review',
  changes: 'Changes requested',
  approved: 'Approved',
};

/**
 * The deliverables of a task and their versions, for everyone on the task. The assignee sends a
 * file for review: pick a deliverable (or name a new one), add a note, then upload. The file
 * becomes the next version and the task moves to In review.
 */
export function TaskDeliverables({
  taskId,
  projectId,
  canSubmit,
}: {
  taskId: string;
  projectId: string;
  canSubmit: boolean;
}) {
  const queryClient = useQueryClient();
  const path = `/tasks/${taskId}/deliverables`;
  const list = useQuery({
    queryKey: ['deliverables', taskId],
    queryFn: () => api(path, { schema: deliverableListSchema }),
  });
  const [target, setTarget] = useState(''); // '' means a new deliverable
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');

  const submit = useMutation({
    mutationFn: async (fileId: string) => {
      let deliverableId = target;
      if (!deliverableId) {
        const created = await api(path, {
          method: 'POST',
          body: { name: newName },
          schema: deliverableSchema,
        });
        deliverableId = created.id;
        setTarget(created.id);
      }
      return api(`/deliverables/${deliverableId}/versions`, {
        method: 'POST',
        body: { fileId, note },
        schema: deliverableSchema,
      });
    },
    onSuccess: () => {
      setNewName('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['deliverables', taskId] });
      void queryClient.invalidateQueries({ queryKey: ['files', `/tasks/${taskId}/files`] });
      void queryClient.invalidateQueries({ queryKey: tasksKey(projectId) });
    },
  });

  const ready = target !== '' || newName.trim() !== '';

  return (
    <div className="mt-2 space-y-4">
      {list.isPending && <Spinner />}
      {list.data?.length === 0 && <p className="text-sm text-muted">No deliverables yet.</p>}
      {list.data?.map((d) => (
        <div key={d.id} className="rounded-md border border-line p-3">
          <p className="text-sm font-medium">{d.name}</p>
          <ul aria-label={`Versions of ${d.name}`} className="mt-2 divide-y divide-line">
            {d.versions.map((v) => (
              <li key={v.id} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{v.number}</span>
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  <span className="shrink-0 text-muted">{formatFileSize(v.size)}</span>
                </div>
                <p className="text-muted">
                  {v.submittedBy}, {formatDateTime(v.submittedAt)} · {STATE_LABEL[v.state]}
                </p>
                {v.note && <p className="mt-1">{v.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {canSubmit && (
        <div className="space-y-3 border-t border-line pt-4">
          <Field label="Deliverable">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">New deliverable…</option>
              {list.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {target === '' && (
            <Field label="New deliverable name">
              <Input value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}
          <Field label="Note for the manager (optional)">
            <Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormError message={errorText(submit.error)} />
          {ready && (
            <FileUploader upload={uploadFile} onUploaded={(info) => submit.mutate(info.id)} />
          )}
        </div>
      )}
    </div>
  );
}
