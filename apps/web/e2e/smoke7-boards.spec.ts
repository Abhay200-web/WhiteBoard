import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Step B4a through the real UI against a real Host: a manager and a freelancer open the same
// project board in two browsers; a note written by one appears on the other's screen with no
// reload, and the other way round. Runs after smoke6-acceptance.spec.ts.
test.describe.configure({ mode: 'serial' });

test('two people on one board see each other’s notes live', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInOwner(page);
  const oto = await join(browser, await createInvite(page, 'guest'), 'Oto', 'oto@free.test');
  const nell = await join(browser, await createInvite(page, 'member'), 'Nell', 'nell@studio.test');

  // The manager (Nell) makes the project and adds the freelancer.
  await nell.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await nell.page.getByRole('link', { name: 'New project' }).click();
  await nell.page.getByLabel('Project name').fill('Board story');
  await nell.page.getByRole('button', { name: 'Create project' }).click();
  await expect(nell.page.getByRole('heading', { name: 'Board story' })).toBeVisible();
  await nell.page.getByLabel('Add a person').selectOption({ label: 'Oto (freelancer)' });
  await nell.page.getByRole('button', { name: 'Add to project' }).click();
  await expect(nell.page.getByRole('list', { name: 'Project members' })).toContainText('Oto');

  // Both open the project's board.
  await nell.page.getByRole('link', { name: 'Open board' }).click();
  await expect(nell.page.getByLabel('Connection')).toHaveText('Live', { timeout: 15_000 });
  await expect(nell.page.getByRole('region', { name: 'Board canvas' })).toBeVisible();

  // The manager adds a note and writes in it.
  await nell.page.getByRole('button', { name: 'Note', exact: true }).click();
  await nell.page.getByLabel('Note text').fill('Moodboard idea');
  await nell.page.getByText('Drag the background').click(); // leaves the note: the text is kept
  await expect(nell.page.getByText('Moodboard idea', { exact: true })).toBeVisible();

  // The freelancer opens the same board and sees the note, and who else is on the board.
  await oto.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await oto.page.getByRole('link', { name: /Board story/ }).click();
  await oto.page.getByRole('link', { name: 'Open board' }).click();
  await expect(oto.page.getByText('Moodboard idea', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(oto.page.getByRole('list', { name: 'Also on this board' })).toContainText('Nell');

  // The freelancer adds a note; the manager sees it without a reload.
  await oto.page.getByRole('button', { name: 'Note', exact: true }).click();
  await oto.page.getByLabel('Note text').fill('Try the darker blue');
  await oto.page.getByText('Drag the background').click();
  await expect(nell.page.getByText('Try the darker blue', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await oto.context.close();
  await nell.context.close();
});
