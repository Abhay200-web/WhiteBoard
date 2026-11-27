import { expect, test, type Page } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Phase C step 6, notification settings, through the real UI: a member turns one kind off and
// hears nothing of it, then turns it back on and hears the next one live.
// Runs after smoke15-statuses.spec.ts.
test.describe.configure({ mode: 'serial' });

async function projectWithMember(page: Page, name: string) {
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByLabel('Add a person').selectOption({ label: 'Sia (member)' });
  await page.getByRole('button', { name: 'Add to project' }).click();
  await expect(page.getByRole('list', { name: 'Project members' })).toContainText('Sia');
}

test('a turned-off kind stays out of the bell until it is turned back on', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page);
  const sia = await join(browser, await createInvite(page, 'member'), 'Sia', 'sia@studio.test');

  await sia.page.goto('/settings/notifications');
  const added = sia.page.getByRole('checkbox', { name: 'Someone adds me to a project' });
  // Each switch saves at once; wait for the Host to keep it before going on.
  const toggle = async () => {
    const saved = sia.page.waitForResponse(
      (r) => r.url().endsWith('/me/notification-settings') && r.request().method() === 'PUT',
    );
    await added.click();
    expect((await saved).status()).toBe(200);
  };
  await toggle();
  await sia.page.reload();
  await expect(added).not.toBeChecked();

  await projectWithMember(page, 'Quiet story');
  // Nothing arrives: the bell has no unread count.
  await expect(sia.page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  await toggle();
  await expect(added).toBeChecked();
  // Exactly one unread: the second project, not the first.
  await projectWithMember(page, 'Loud story');
  await expect(sia.page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible({
    timeout: 15_000,
  });

  await sia.context.close();
});
