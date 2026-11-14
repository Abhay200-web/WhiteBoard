import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Part 4 exit check (docs/MASTER_PLAN.md), through the real UI against a real Host: the manager
// assigns a task, the artist hears about it live, works on it, the manager sees it move live,
// and removing the artist asks who takes her task over. Runs after smoke.spec.ts.
test.describe.configure({ mode: 'serial' });

test('assign, hear live, comment, move, see it live, and hand over on removal', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000); // the whole Part 4 story, in two browsers
  // The owner is the manager here. Ada, a freelancer, joins from her own PC.
  await signInOwner(page);
  const ada = await join(browser, await createInvite(page, 'guest'), 'Ada', 'ada@free.test');

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Brand refresh');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Brand refresh' })).toBeVisible();
  await page.getByLabel('Add a person').selectOption({ label: 'Ada (freelancer)' });
  await page.getByRole('button', { name: 'Add to project' }).click();

  // The manager creates "Logo concepts": High, due in 3 days, assigned to Ada.
  await page.getByLabel('New task title').fill('Logo concepts');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Logo concepts' }).click();
  const drawer = page.getByRole('dialog', { name: 'Logo concepts' });
  await drawer.getByLabel('Priority').selectOption('High');
  const due = new Date(Date.now() + 3 * 86_400_000);
  due.setHours(17, 0, 0, 0);
  const local = new Date(due.getTime() - due.getTimezoneOffset() * 60_000);
  await drawer.getByLabel('Due').fill(local.toISOString().slice(0, 16));
  await drawer.getByRole('checkbox', { name: 'Ada' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Ada' })).toBeChecked();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Board' }).click();

  // Ada's bell shows it without a reload: added to the project, then assigned.
  await expect(ada.page.getByRole('button', { name: 'Notifications, 2 unread' })).toBeVisible();

  // She opens My tasks: the task is due this week.
  await ada.page.getByRole('link', { name: 'My tasks' }).click();
  const thisWeek = ada.page.getByRole('region', { name: 'This week' });
  await expect(thisWeek).toContainText('Logo concepts');
  await expect(thisWeek).toContainText('High');
  await thisWeek.getByRole('button', { name: 'Logo concepts' }).click();

  // She asks the manager a question, @-mentioning him.
  const herDrawer = ada.page.getByRole('dialog', { name: 'Logo concepts' });
  await herDrawer.getByLabel('New comment').pressSequentially('Any colours to avoid, @Ow');
  await herDrawer.getByRole('button', { name: '@Owner' }).click();
  await herDrawer.getByRole('button', { name: 'Comment' }).click();
  await expect(herDrawer.getByRole('list', { name: 'Comments' })).toContainText('@Owner');
  await herDrawer.getByRole('button', { name: 'Close' }).click();

  // She drags the card to In progress on the project board.
  await ada.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await ada.page.getByRole('link', { name: /Brand refresh/ }).click();
  await ada.page.getByRole('button', { name: 'Board' }).click();
  const herInProgress = ada.page.getByRole('region', { name: 'In progress' });
  await herInProgress.scrollIntoViewIfNeeded();
  await ada.page
    .getByRole('region', { name: 'To do' })
    .getByRole('article')
    .filter({ hasText: 'Logo concepts' })
    .dragTo(herInProgress);
  await expect(herInProgress).toContainText('Logo concepts');

  // The manager's board updates live, and his bell has her mention.
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Logo concepts');
  await page.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(
    'Ada mentioned you on Logo concepts',
  );
  await page.keyboard.press('Escape');

  // Removing Ada asks who takes her open task over; he takes it himself.
  // A fresh load of Members: this tab fetched the list seconds ago, while creating Ada's invite
  // (before she joined), and the app reuses data younger than 5 s. A person is never that fast.
  await page.goto('/members');
  await page.getByRole('button', { name: 'Remove Ada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Ada?' });
  await dialog.getByLabel('Give Logo concepts to').selectOption('Owner');
  await dialog.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: /Brand refresh/ }).click();
  await page.getByRole('button', { name: 'Board' }).click();
  const card = page.getByRole('region', { name: 'In progress' }).getByRole('article');
  await expect(card).toContainText('Owner');
  await expect(card).not.toContainText('Ada');
  await ada.context.close();
});
