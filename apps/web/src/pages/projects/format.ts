import type { ProjectMemberRole, ProjectStatus } from '@whiteboard/core';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  in_review: 'In review',
  delivered: 'Delivered',
  archived: 'Archived',
};

/** Button text for moving a project to a status. */
export const STATUS_ACTION: Record<ProjectStatus, string> = {
  draft: 'Move back to draft',
  active: 'Mark as active',
  in_review: 'Send to review',
  delivered: 'Mark as delivered',
  archived: 'Archive',
};

export const ROLE_LABEL: Record<ProjectMemberRole, string> = {
  manager: 'Manager',
  artist: 'Artist',
};

export function formatDate(ms: number | null): string {
  return ms === null
    ? '-'
    : new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/** Local start of day for a `yyyy-mm-dd` date input, as Unix ms. */
export const startOfDay = (date: string): number => new Date(`${date}T00:00:00`).getTime();
/** Local end of day, so a deadline "today" lasts until midnight. */
export const endOfDay = (date: string): number => new Date(`${date}T23:59:59`).getTime();

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}
