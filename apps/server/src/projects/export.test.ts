import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { buildMarkdown, buildPdf, type ProjectExport } from './export';

const DATA: ProjectExport = {
  name: 'Poster – Café',
  clientName: null,
  status: 'active',
  deadline: null,
  generatedAt: new Date(2026, 10, 27).getTime(),
  progress: { total: 201, done: 1, open: 200, overdue: 0, dueSoon: 0 },
  groups: [
    {
      name: 'To do',
      kind: 'todo',
      tasks: Array.from({ length: 200 }, (_, i) => ({
        title: `Task ${i} with a fairly long title so that the line has to wrap onto the page`,
        priority: 'low' as const,
        dueAt: null,
        assignees: [],
      })),
    },
  ],
};

describe('project export files', () => {
  it('writes a multi-page PDF that loads back', async () => {
    const bytes = await buildPdf(DATA);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('keeps the Markdown headings and counts', () => {
    const md = buildMarkdown(DATA);
    expect(md.startsWith('# Poster – Café\n')).toBe(true);
    expect(md).toContain('- Tasks: 201 (1 done, 200 open)');
    expect(md).toContain('- [ ] Task 0 with a fairly long title');
  });
});
