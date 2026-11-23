import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Step 5.2 through the real UI against a real Host: Bea sends a poster for review, the manager
// asks for changes, Bea sends version 2, and the manager approves it. Runs after smoke3-tasks.spec.ts.
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('send for review, ask for changes, send again, approve', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // The owner is the manager. Bea, a freelancer, is the artist on the poster.
  await signInOwner(page);
  const bea = await join(browser, await createInvite(page, 'guest'), 'Bea', 'bea@free.test');

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Poster series');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Poster series' })).toBeVisible();
  await page.getByLabel('Add a person').selectOption({ label: 'Bea (freelancer)' });
  await page.getByRole('button', { name: 'Add to project' }).click();

  await page.getByLabel('New task title').fill('Poster');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Poster', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Poster' });
  await drawer.getByRole('checkbox', { name: 'Bea' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Bea' })).toBeChecked();
  await drawer.getByRole('button', { name: 'Close' }).click();

  // Bea sends version 1 of "Poster" from her task drawer. The task moves to In review.
  await bea.page.getByRole('link', { name: 'My tasks' }).click();
  await bea.page.getByRole('button', { name: 'Poster', exact: true }).click();
  const herDrawer = bea.page.getByRole('dialog', { name: 'Poster' });
  await herDrawer.getByLabel('New deliverable name').fill('Poster');
  await herDrawer.getByLabel(/Choose a file/).setInputFiles({
    name: 'poster.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const herList = herDrawer.getByRole('list', { name: 'Versions of Poster' });
  await expect(herList).toContainText('v1');
  await herDrawer.getByRole('button', { name: 'Close' }).click();

  // The manager's review queue lists it; the review page shows the file and the artist's note.
  await page.goto('/review-queue');
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Poster' })).toBeVisible();
  await expect(page.getByText('Poster v1')).toBeVisible();
  await page.getByLabel('Summary for the artist').fill('The logo is too small');
  await page.getByRole('button', { name: 'Request changes' }).click();
  await expect(page.getByText('Nothing is waiting for review on this task.')).toBeVisible();

  // Bea opens the task fresh and sees the summary; she sends version 2.
  await bea.page.goto('/my-tasks');
  await bea.page.getByRole('button', { name: 'Poster', exact: true }).click();
  const again = bea.page.getByRole('dialog', { name: 'Poster' });
  await expect(again).toContainText('The logo is too small');
  await again.getByLabel('Deliverable', { exact: true }).selectOption('Poster');
  await again.getByLabel(/Choose a file/).setInputFiles({
    name: 'poster-v2.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(again.getByRole('list', { name: 'Versions of Poster' })).toContainText('v2');
  await again.getByRole('button', { name: 'Close' }).click();

  // The manager approves version 2: the task moves to Approved.
  await page.goto('/review-queue');
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Poster v2')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Nothing is waiting for review on this task.')).toBeVisible();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: /Poster series/ }).click();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Approved' })).toContainText('Poster');
  await bea.context.close();
});
