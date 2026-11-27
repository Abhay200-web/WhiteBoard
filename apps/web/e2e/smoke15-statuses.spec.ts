import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 6, custom task statuses, through the real UI: a manager adds a status, it
// becomes a kanban column, moves up, is renamed and deleted; the last "To do" cannot go.
// Runs after smoke14-board-png.spec.ts.
test.describe.configure({ mode: 'serial' });

test('a manager adds, moves, renames and deletes a task status', async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Status story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Status story' })).toBeVisible();

  // The task section shows its kanban, so each status is a column there.
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  const statuses = page.getByRole('list', { name: 'Task statuses' });
  await expect(statuses.getByRole('listitem')).toHaveCount(6);
  await page.getByLabel('New status').fill('Waiting on client');
  await page.getByLabel('Behaves like').selectOption({ label: 'In progress' });
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(statuses.getByRole('listitem')).toHaveCount(7);
  await expect(page.getByRole('region', { name: 'Waiting on client' })).toBeVisible();

  // Up one place: now before Done.
  await page.getByRole('button', { name: 'Move Waiting on client up' }).click();
  await expect(statuses.getByRole('listitem').nth(5)).toContainText('Waiting on client');

  await page.getByRole('button', { name: 'Rename Waiting on client' }).click();
  await page.getByLabel('New name for Waiting on client').fill('With client');
  await statuses.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'With client' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete With client' }).click();
  await expect(statuses.getByRole('listitem')).toHaveCount(6);
  await expect(page.getByRole('region', { name: 'With client' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete To do' }).click();
  await expect(
    page.getByText('The project needs at least one status that behaves like To do'),
  ).toBeVisible();
});
