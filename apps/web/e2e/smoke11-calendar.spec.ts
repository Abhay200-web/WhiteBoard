import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 2, calendar view and saved filters, through the real UI: a task with a due date
// shows on its day, another without one is counted, a task opens from the calendar, and a saved
// view comes back after a reload. Runs after smoke10-search.spec.ts.
test.describe.configure({ mode: 'serial' });

test('calendar shows tasks on their due day, and a saved view survives a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Calendar story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar story' })).toBeVisible();

  // A task due today at noon (local time), and one with no due date.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T12:00`;
  await page.getByLabel('New task title').fill('Final approval');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Final approval' }).click();
  await page.getByLabel('Due').fill(today);
  await page.getByLabel('Due').press('Tab');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel('New task title').fill('Someday');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('button', { name: 'Someday' })).toBeVisible();

  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const todayCell = page.locator('div.min-h-24', { has: page.getByText('Final approval') });
  await expect(todayCell).toHaveCount(1);
  await expect(page.getByText('1 without a due date is not shown.')).toBeVisible();

  // A task opens from the calendar.
  await page.getByRole('button', { name: 'Final approval' }).click();
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Final approval');
  await page.getByRole('button', { name: 'Close' }).click();

  // A saved view: nothing is urgent, so the view shows no tasks, and it is still there after a reload.
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByLabel('Filter by priority').selectOption('urgent');
  await expect(page.getByText('No tasks match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByLabel('View name').fill('Urgent only');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('button', { name: 'Urgent only', exact: true })).toBeVisible();

  await page.goto('/projects/' + new URL(page.url()).pathname.split('/')[2]);
  await page.getByRole('button', { name: 'Urgent only', exact: true }).click();
  await expect(page.getByText('No tasks match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('button', { name: 'Someday' })).toBeVisible();
});
