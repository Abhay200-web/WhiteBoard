import type { ProjectMemberRole, ProjectStatus, TaskPriority } from '@whiteboard/core';

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

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
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

/** Date and time, e.g. "Mar 1, 10:30 AM" (local). */
export const formatDateTime = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Local start of day for a `yyyy-mm-dd` date input, as Unix ms. */
export const startOfDay = (date: string): number => new Date(`${date}T00:00:00`).getTime();
/** Local end of day, so a deadline "today" lasts until midnight. */
export const endOfDay = (date: string): number => new Date(`${date}T23:59:59`).getTime();
/** Unix ms as the local `yyyy-mm-dd` a date input expects; empty when there is no date. */
export const toDateInput = (ms: number | null | undefined): string =>
  ms == null ? '' : new Date(ms).toLocaleDateString('en-CA');
/** Unix ms as the local `yyyy-mm-ddThh:mm` a `datetime-local` input expects. */
export const toDateTimeInput = (ms: number | null): string =>
  ms == null ? '' : `${toDateInput(ms)}T${new Date(ms).toTimeString().slice(0, 5)}`;

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
}
