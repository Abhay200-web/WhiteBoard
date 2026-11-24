import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Step 5.4 through the real UI against a real Host: the manager drops a pin on Cy's banner and
// writes to its thread, then Cy opens the same version, answers and resolves the pin.
// Runs after smoke4-reviews.spec.ts, so the names here are its own (Cy, "Banner").
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('drop a pin, answer in its thread, resolve it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInOwner(page);
  const cy = await join(browser, await createInvite(page, 'guest'), 'Cy', 'cy@free.test');

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Banner pins');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Banner pins' })).toBeVisible();
  await page.getByLabel('Add a person').selectOption({ label: 'Cy (freelancer)' });
  await page.getByRole('button', { name: 'Add to project' }).click();

  await page.getByLabel('New task title').fill('Banner');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Banner', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Banner' });
  await drawer.getByRole('checkbox', { name: 'Cy' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Cy' })).toBeChecked();
  await drawer.getByRole('button', { name: 'Close' }).click();

  // Cy sends the banner for review.
  await cy.page.getByRole('link', { name: 'My tasks' }).click();
  await cy.page.getByRole('button', { name: 'Banner', exact: true }).click();
  const cyDrawer = cy.page.getByRole('dialog', { name: 'Banner' });
  await cyDrawer.getByLabel('New deliverable name').fill('Banner');
  await cyDrawer.getByLabel(/Choose a file/).setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(cyDrawer.getByRole('list', { name: 'Versions of Banner' })).toContainText('v1');
  await cyDrawer.getByRole('button', { name: 'Close' }).click();

  // The manager clicks the banner to drop pin 1, and writes to its thread.
  await page.goto('/review-queue');
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  // The pin layer covers the image, so a plain click is refused; a forced click lands on the layer.
  await page.getByRole('img', { name: 'banner.png' }).click({ force: true });
  await expect(page.getByRole('button', { name: 'Pin 1, open' })).toBeVisible();
  await page.getByLabel('Reply').fill('Make the logo bigger');
  await page.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByText('Make the logo bigger', { exact: true })).toBeVisible();

  // Cy opens the task's preview, answers in the thread and resolves the pin.
  await cy.page.getByRole('button', { name: 'Banner', exact: true }).click();
  await cy.page
    .getByRole('dialog', { name: 'Banner' })
    .getByRole('button', { name: 'Preview and pins' })
    .click();
  await cy.page.getByRole('button', { name: 'Pin 1, open' }).click();
  await expect(cy.page.getByText('Make the logo bigger', { exact: true })).toBeVisible();
  await cy.page.getByLabel('Reply').fill('Done, see v2');
  await cy.page.getByRole('button', { name: 'Reply' }).click();
  await expect(cy.page.getByText('Done, see v2', { exact: true })).toBeVisible();
  await cy.page.getByRole('button', { name: 'Resolve' }).click();
  // The filter shows open pins only, so the resolved pin leaves the picture; its thread stays open.
  await expect(cy.page.getByRole('button', { name: 'Reopen' })).toBeVisible();

  await cy.context.close();
});
