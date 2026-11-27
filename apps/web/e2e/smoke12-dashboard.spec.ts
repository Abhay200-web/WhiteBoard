import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 3, dashboard and reporting, through the real UI: a task due yesterday shows as
// overdue, the open count and progress follow the tasks, and the dashboard opens from the project.
// Runs after smoke11-calendar.spec.ts.
test.describe.configure({ mode: 'serial' });

test('dashboard counts open, overdue and done tasks for the project', async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Dashboard story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard story' })).toBeVisible();

  // A task due yesterday (overdue), and one with no date.
  const yesterday = new Date(Date.now() - 24 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const due = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T12:00`;
  await page.getByLabel('New task title').fill('Late poster');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Late poster' }).click();
  await page.getByLabel('Due').fill(due);
  await page.getByLabel('Due').press('Tab');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel('New task title').fill('Brief');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('button', { name: 'Brief' })).toBeVisible();

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toContainText('Dashboard story');
  const tile = (label: string) =>
    page.locator('p', { hasText: new RegExp(`^${label}$`) }).locator('..');
  await expect(tile('Open tasks')).toContainText('2');
  await expect(tile('Overdue')).toContainText('1');
  await expect(page.getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await expect(page.getByText('no decisions yet')).toBeVisible();
});
