import type { ProjectReport, TaskPriority, TaskStatusKind } from '@whiteboard/core';
import { projects, taskAssignees, taskStatuses, tasks, users, type Db } from '@whiteboard/db';
import { asc, eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { projectReport } from './report';

export interface ExportTask {
  title: string;
  priority: TaskPriority;
  dueAt: number | null;
  assignees: string[];
}

export interface ExportGroup {
  name: string;
  kind: TaskStatusKind;
  tasks: ExportTask[];
}

/** Everything a project export contains: the header, the progress numbers and the tasks by status. */
export interface ProjectExport {
  name: string;
  clientName: string | null;
  status: string;
  deadline: number | null;
  generatedAt: number;
  progress: ProjectReport['progress'];
  groups: ExportGroup[];
}

/** Reads a project for export. Returns null when the project does not exist. */
export function loadProjectExport(
  db: Db,
  projectId: string,
  now = Date.now(),
): ProjectExport | null {
  const project = db
    .select({
      name: projects.name,
      clientName: projects.clientName,
      status: projects.status,
      deadline: projects.deadline,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return null;

  const statuses = db
    .select({ id: taskStatuses.id, name: taskStatuses.name, kind: taskStatuses.kind })
    .from(taskStatuses)
    .where(eq(taskStatuses.projectId, projectId))
    .orderBy(asc(taskStatuses.sortKey))
    .all();
  const projectTasks = db
    .select({
      id: tasks.id,
      statusId: tasks.statusId,
      title: tasks.title,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sortKey))
    .all();
  const assignees = db
    .select({ taskId: taskAssignees.taskId, name: users.name })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(eq(tasks.projectId, projectId))
    .all();

  const namesByTask = new Map<string, string[]>();
  for (const a of assignees) {
    namesByTask.set(a.taskId, [...(namesByTask.get(a.taskId) ?? []), a.name]);
  }

  return {
    name: project.name,
    clientName: project.clientName,
    status: project.status,
    deadline: project.deadline ? project.deadline.getTime() : null,
    generatedAt: now,
    progress: projectReport(db, projectId, now).progress,
    groups: statuses.map((s) => ({
      name: s.name,
      kind: s.kind,
      tasks: projectTasks
        .filter((t) => t.statusId === s.id)
        .map((t) => ({
          title: t.title,
          priority: t.priority,
          dueAt: t.dueAt ? t.dueAt.getTime() : null,
          assignees: namesByTask.get(t.id) ?? [],
        })),
    })),
  };
}

/** Local calendar date as YYYY-MM-DD, or "none". */
export function day(time: number | null): string {
  if (time === null) return 'none';
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function taskDetails(task: ExportTask): string {
  const parts = [`priority ${task.priority}`, `due ${day(task.dueAt)}`];
  if (task.assignees.length > 0) parts.push(`assigned to ${task.assignees.join(', ')}`);
  return parts.join(', ');
}

/** The export as Markdown. Done tasks are ticked. */
export function buildMarkdown(data: ProjectExport): string {
  const { progress } = data;
  const lines = [
    `# ${data.name}`,
    '',
    `Client: ${data.clientName ?? 'none'}  `,
    `Status: ${data.status}  `,
    `Deadline: ${day(data.deadline)}  `,
    `Exported: ${day(data.generatedAt)}`,
    '',
    '## Progress',
    '',
    `- Tasks: ${progress.total} (${progress.done} done, ${progress.open} open)`,
    `- Overdue: ${progress.overdue}`,
    `- Due in the next 7 days: ${progress.dueSoon}`,
  ];
  for (const group of data.groups) {
    lines.push('', `## ${group.name}`, '');
    if (group.tasks.length === 0) lines.push('_No tasks._');
    for (const task of group.tasks) {
      const box = group.kind === 'done' ? '[x]' : '[ ]';
      lines.push(`- ${box} ${task.title} (${taskDetails(task)})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
  indent?: number;
  gapBefore?: number;
}

/** The export as the same lines the PDF prints. Plain ASCII, because the standard PDF fonts cannot draw other characters. */
function pdfLines(data: ProjectExport): PdfLine[] {
  const { progress } = data;
  const lines: PdfLine[] = [
    { text: data.name, bold: true, size: 18 },
    { text: `Client: ${data.clientName ?? 'none'}` },
    { text: `Status: ${data.status}` },
    { text: `Deadline: ${day(data.deadline)}` },
    { text: `Exported: ${day(data.generatedAt)}` },
    { text: 'Progress', bold: true, size: 13, gapBefore: 14 },
    { text: `Tasks: ${progress.total} (${progress.done} done, ${progress.open} open)`, indent: 10 },
    { text: `Overdue: ${progress.overdue}`, indent: 10 },
    { text: `Due in the next 7 days: ${progress.dueSoon}`, indent: 10 },
  ];
  for (const group of data.groups) {
    lines.push({ text: group.name, bold: true, size: 13, gapBefore: 14 });
    if (group.tasks.length === 0) lines.push({ text: 'No tasks.', indent: 10 });
    for (const task of group.tasks) {
      const box = group.kind === 'done' ? '[x]' : '[ ]';
      lines.push({ text: `${box} ${task.title} (${taskDetails(task)})`, indent: 10 });
    }
  }
  return lines;
}

/** Keeps characters the standard PDF fonts can draw; everything else becomes "?". */
const winAnsi = (text: string) => text.replace(/\s+/g, ' ').replace(/[^\x20-\x7e]/g, '?');

/** Splits text into lines that fit the width. */
function wrap(text: string, width: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && width(next) > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  out.push(current);
  return out;
}

/** The export as an A4 PDF. Long lines wrap and the text moves to a new page when it runs out. */
export async function buildPdf(data: ProjectExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 50;
  const maxWidth = PAGE_W - 2 * MARGIN;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  for (const line of pdfLines(data)) {
    const font = line.bold ? bold : regular;
    const size = line.size ?? 11;
    const indent = line.indent ?? 0;
    y -= line.gapBefore ?? 0;
    const measure = (s: string) => font.widthOfTextAtSize(s, size);
    for (const part of wrap(winAnsi(line.text), measure, maxWidth - indent)) {
      if (y - size < MARGIN) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      page.drawText(part, { x: MARGIN + indent, y: y - size, size, font });
      y -= size * 1.4;
    }
  }
  return doc.save();
}
