import type { Project } from '@whiteboard/core';

import { FileThumbnail, useFileLink } from '../../components/FilePreview';
import { getHostUrl } from '../../lib/api';

/**
 * Top of a project card (a `Card` with `p-4 overflow-hidden`): the cover's thumbnail, edge to
 * edge, else a strip in the project's colour.
 */
export function CardCover({ project }: { project: Project }) {
  if (project.coverFileId) {
    return (
      <FileThumbnail
        fileId={project.coverFileId}
        name={`${project.name} cover`}
        className="-mx-4 -mt-4 mb-3 h-28 w-[calc(100%+2rem)] max-w-none object-cover"
      />
    );
  }
  return project.color ? <ColorStrip color={project.color} className="-mx-4 -mt-4 mb-3" /> : null;
}

/** Top of the project page: the whole cover picture, else the colour strip. */
export function PageCover({ project }: { project: Project }) {
  const link = useFileLink(project.coverFileId ?? '', project.coverFileId !== null);
  if (project.coverFileId) {
    // Nothing shows until the link arrives, or if the picture cannot be read.
    return link.data ? (
      <img
        src={`${getHostUrl()}${link.data.url}`}
        alt={`${project.name} cover`}
        className="mb-4 h-44 w-full rounded-lg object-cover"
      />
    ) : null;
  }
  return project.color ? <ColorStrip color={project.color} className="mb-4 rounded-full" /> : null;
}

function ColorStrip({ color, className }: { color: string; className: string }) {
  return (
    <div aria-hidden="true" className={`h-2 ${className}`} style={{ backgroundColor: color }} />
  );
}
