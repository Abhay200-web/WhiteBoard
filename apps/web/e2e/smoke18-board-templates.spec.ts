import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 6, board templates, through the real UI against a real Host: a board saved as a
// template starts a new board with its cards, and so does a built-in template.
// Runs after smoke17-covers.spec.ts.
test.describe.configure({ mode: 'serial' });

test('a board saved as a template starts a new board with its cards', async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Template story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Template story' })).toBeVisible();
  await page.getByRole('link', { name: 'Open board' }).click();
  await expect(page.getByLabel('Connection')).toHaveText('Live', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column title').fill('Sketches');
  await page.getByText('Drag the background').click();
  await expect(page.getByText('Sketches', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save as template' }).click();
  const save = page.getByRole('dialog', { name: 'Save as template' });
  await save.getByLabel('Template name').fill('Studio start');
  await expect(save).toContainText('1 card will be kept.');
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(save.getByRole('status')).toContainText('“Studio start” is now offered');
  await save.getByRole('button', { name: 'Done' }).click();

  // A new board from the saved template opens with the column.
  const canvas = page.getByRole('region', { name: 'Board canvas' });
  const addBoard = async (name: string, template: string) => {
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New board' });
    await dialog.getByLabel('Board name').fill(name);
    await dialog.getByRole('radio', { name: new RegExp(template) }).check();
    await dialog.getByRole('button', { name: 'Create board' }).click();
    await expect(dialog).toBeHidden();
    await expect(canvas.getByText(name)).toBeVisible();
  };
  const open = async (name: string) => {
    await canvas.getByText(name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open board' }).click();
    await expect(page.getByRole('navigation', { name: 'Board trail' })).toContainText(name);
  };
  await addBoard('Kickoff', 'Studio start');
  await open('Kickoff');
  await expect(page.getByText('Sketches', { exact: true })).toBeVisible({ timeout: 15_000 });

  // And one from a built-in template.
  await addBoard('Looking back', 'Retrospective');
  await open('Looking back');
  await expect(page.getByText('Went well', { exact: true })).toBeVisible({ timeout: 15_000 });
});
