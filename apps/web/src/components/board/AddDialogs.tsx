import { useMutation, useQuery } from '@tanstack/react-query';
import {
  linkPreviewSchema,
  projectFileListSchema,
  type LinkPreview,
  type ProjectFile,
} from '@whiteboard/core';
import { Button, Field, FileUploader, Input, Modal } from '@whiteboard/ui';
import { useState } from 'react';

import { api, errorText } from '../../lib/api';
import { uploadFile } from '../../lib/files';

/** Asks for a web address; the Host reads the page's title and description. */
export function LinkDialog({
  boardId,
  onPreview,
  onClose,
}: {
  boardId: string;
  onPreview: (preview: LinkPreview) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const preview = useMutation({
    mutationFn: () =>
      api(`/boards/${boardId}/link-preview`, {
        method: 'POST',
        body: { url },
        schema: linkPreviewSchema,
      }),
    onSuccess: onPreview,
  });
  return (
    <Modal title="Add a link" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          preview.mutate();
        }}
      >
        <Field label="Web address">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
          />
        </Field>
        {errorText(preview.error) && (
          <p role="alert" className="text-sm text-danger">
            {errorText(preview.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={!url.trim()} loading={preview.isPending}>
            Add link
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Picks a file already on the project, or uploads one and adds it to the project. */
export function FilePickDialog({
  projectId,
  kind,
  onPick,
  onClose,
}: {
  projectId: string;
  kind: 'image' | 'file';
  onPick: (file: { fileId: string; name: string; mimeType: string }) => void;
  onClose: () => void;
}) {
  const files = useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => api(`/projects/${projectId}/files`, { schema: projectFileListSchema }),
  });
  const attach = useMutation({
    mutationFn: (fileId: string) =>
      api(`/projects/${projectId}/files`, {
        method: 'POST',
        body: { fileId, kind: 'reference' },
      }),
  });
  const usable = (f: ProjectFile) => kind === 'file' || /^image\//.test(f.mimeType);

  return (
    <Modal title={kind === 'image' ? 'Add a picture' : 'Add a file'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ul aria-label="Project files" className="flex max-h-64 flex-col gap-1 overflow-auto">
          {files.data?.filter(usable).map((f) => (
            <li key={f.fileId}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => onPick({ fileId: f.fileId, name: f.name, mimeType: f.mimeType })}
              >
                {f.name}
              </button>
            </li>
          ))}
          {files.data && files.data.filter(usable).length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              No files of this kind on the project yet.
            </li>
          )}
        </ul>
        <FileUploader
          upload={uploadFile}
          onUploaded={(info) => {
            // Added to the project so everyone on it can see the file; a manager may be needed.
            attach.mutate(info.id, {
              onSuccess: () =>
                onPick({ fileId: info.id, name: info.name, mimeType: info.mimeType }),
            });
          }}
        />
        {errorText(attach.error) && (
          <p role="alert" className="text-sm text-danger">
            {errorText(attach.error)} Ask a manager to add the file to the project.
          </p>
        )}
      </div>
    </Modal>
  );
}
