import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectFileListSchema, type ProjectFile } from '@whiteboard/core';
import { Button, Card, FileUploader, Modal, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../components/AuthShell';
import { FilePreview, FileThumbnail } from '../../components/FilePreview';
import { api, ApiError } from '../../lib/api';
import { uploadFile } from '../../lib/files';
import { formatFileSize } from './format';

/** Files of a project. Members can open them; managers can add and remove. */
export function ProjectFilesCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<ProjectFile | null>(null);
  const files = useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => api(`/projects/${projectId}/files`, { schema: projectFileListSchema }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project-files', projectId] });

  const attach = useMutation({
    mutationFn: (fileId: string) =>
      api(`/projects/${projectId}/files`, {
        method: 'POST',
        body: { fileId, kind: 'reference' },
      }),
    onSuccess: refresh,
  });
  const detach = useMutation({
    mutationFn: (fileId: string) =>
      api(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <Card>
      <h2 className="font-semibold">Files</h2>
      {files.isPending && <Spinner />}
      {files.data && files.data.length === 0 && (
        <p className="mt-2 text-sm text-muted">No files yet.</p>
      )}
      {files.data && files.data.length > 0 && (
        <ul aria-label="Project files" className="mt-2 divide-y divide-line">
          {files.data.map((f) => (
            <li key={f.fileId} className="flex items-center gap-3 py-2 text-sm">
              {f.hasThumbnail && <FileThumbnail fileId={f.fileId} name={f.name} />}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-accent underline"
                onClick={() => setOpen(f)}
              >
                {f.name}
              </button>
              <span className="shrink-0 text-muted">{formatFileSize(f.size)}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  aria-label={`Remove file ${f.name}`}
                  loading={detach.isPending && detach.variables === f.fileId}
                  onClick={() => detach.mutate(f.fileId)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError
        message={
          (attach.error instanceof ApiError && attach.error.message) ||
          (detach.error instanceof ApiError && detach.error.message) ||
          null
        }
      />
      {canManage && (
        <FileUploader
          className="mt-4"
          upload={uploadFile}
          onUploaded={(info) => attach.mutate(info.id)}
        />
      )}
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}>
          <FilePreview fileId={open.fileId} name={open.name} mimeType={open.mimeType} />
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
