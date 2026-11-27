import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 1, full search, through the real UI: a project, a task and a comment are found by
// words from each, and a hit leads to the project. Runs after smoke9-task-cards.spec.ts.
test.describe.configure({ mode: 'serial' });

test('search finds projects, tasks and comments, and a result opens its project', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Search story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Search story' })).toBeVisible();
  await page.getByLabel('New task title').fill('Poster drafts');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Poster drafts' }).click();
  await page.getByLabel('New comment').fill('Use the brighter red');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Use the brighter red')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search for').fill('brighter');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results).toContainText('Comment');
  await expect(results).toContainText('Poster drafts');
  await expect(results.locator('mark')).toHaveText('brighter');

  await page.getByLabel('Search for').fill('search');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText('Search story');
  await page.getByRole('link', { name: /Search story/ }).click();
  await expect(page.getByRole('heading', { name: 'Search story' })).toBeVisible();
});
