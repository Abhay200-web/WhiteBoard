import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

import { day, type ProjectExport } from './export';

/** The export as a Word document: headings for the progress and each status, one bullet per task. */
export async function buildDocx(data: ProjectExport): Promise<Buffer> {
  const { progress } = data;
  const children: Paragraph[] = [
    new Paragraph({ text: data.name, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `Client: ${data.clientName ?? 'none'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Status: ${data.status}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Deadline: ${day(data.deadline)}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Exported: ${day(data.generatedAt)}` })] }),
    new Paragraph({ text: 'Progress', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      bullet: { level: 0 },
      text: `Tasks: ${progress.total} (${progress.done} done, ${progress.open} open)`,
    }),
    new Paragraph({ bullet: { level: 0 }, text: `Overdue: ${progress.overdue}` }),
    new Paragraph({
      bullet: { level: 0 },
      text: `Due in the next 7 days: ${progress.dueSoon}`,
    }),
  ];
  for (const group of data.groups) {
    children.push(new Paragraph({ text: group.name, heading: HeadingLevel.HEADING_2 }));
    if (group.tasks.length === 0) children.push(new Paragraph({ text: 'No tasks.' }));
    for (const task of group.tasks) {
      const box = group.kind === 'done' ? '[x]' : '[ ]';
      const details = [`priority ${task.priority}`, `due ${day(task.dueAt)}`];
      if (task.assignees.length > 0) details.push(`assigned to ${task.assignees.join(', ')}`);
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          text: `${box} ${task.title} (${details.join(', ')})`,
        }),
      );
    }
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
