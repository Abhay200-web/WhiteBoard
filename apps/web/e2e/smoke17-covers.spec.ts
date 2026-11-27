import { expect, test, type Locator } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Phase C step 6, project covers, through the real UI: a cover picture and a colour chosen when
// creating a project show on its card and page, also for a member who did not upload the picture.
// Runs after smoke16-notification-settings.spec.ts.
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The picture really loaded from the Host (a broken image has no width). */
const loaded = (img: Locator) =>
  expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

test('a cover picture shows on the card and the page, for every member', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page);
  const noor = await join(browser, await createInvite(page, 'member'), 'Noor', 'noor@studio.test');

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Covered story');
  await page.getByLabel(/Choose a file/).setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByRole('img', { name: 'Cover picture' })).toBeVisible();
  // The radio itself is hidden; a person clicks the swatch around it.
  await page.getByTitle('Teal').click();
  await expect(page.getByRole('radio', { name: 'Teal' })).toBeChecked();
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: 'Covered story' })).toBeVisible();
  await loaded(page.getByRole('img', { name: 'Covered story cover' }));
  await page.getByLabel('Add a person').selectOption({ label: 'Noor (member)' });
  await page.getByRole('button', { name: 'Add to project' }).click();
  await expect(page.getByRole('list', { name: 'Project members' })).toContainText('Noor');

  // Noor never uploaded the picture, yet sees it as the project's cover.
  await noor.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await loaded(noor.page.getByRole('img', { name: 'Covered story cover' }));
  await noor.page.getByRole('link', { name: /Covered story/ }).click();
  await loaded(noor.page.getByRole('img', { name: 'Covered story cover' }));

  await noor.context.close();
});
