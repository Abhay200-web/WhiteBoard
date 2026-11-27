import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 5, export, through the real UI: the dashboard downloads the project as Markdown
// as PDF, Word and a zip. Runs after smoke12-dashboard.spec.ts.
test.describe.configure({ mode: 'serial' });

test('the dashboard exports the project as Markdown and PDF', async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Export story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Export story' })).toBeVisible();

  await page.getByLabel('New task title').fill('Poster');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('button', { name: 'Poster' })).toBeVisible();

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toContainText('Export story');

  const markdown = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown' }).click();
  const md = await markdown;
  expect(md.suggestedFilename()).toBe('Export story - export.md');
  const text = readFileSync((await md.path())!, 'utf8');
  expect(text).toContain('# Export story');
  expect(text).toContain('- [ ] Poster (priority medium, due none)');

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const file = await pdf;
  expect(file.suggestedFilename()).toBe('Export story - export.pdf');
  expect(
    readFileSync((await file.path())!)
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');

  const word = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Word' }).click();
  expect((await word).suggestedFilename()).toBe('Export story - export.docx');

  const zip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export zip with files' }).click();
  expect((await zip).suggestedFilename()).toBe('Export story - export.zip');
});
