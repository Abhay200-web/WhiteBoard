import { Card } from '@whiteboard/ui';

import { AttachedFiles } from './AttachedFiles';

/** Files of a project. Members can open them; managers can add and remove. */
export function ProjectFilesCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  return (
    <Card>
      <h2 className="font-semibold">Files</h2>
      <AttachedFiles
        path={`/projects/${projectId}/files`}
        label="Project files"
        canManage={canManage}
      />
    </Card>
  );
}
