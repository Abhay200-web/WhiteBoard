import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Step B4b through the real UI against a real Host: columns, undo / redo and the right-click
// menu on a board, with a second person on the same board. Runs after smoke7-boards.spec.ts.
test.describe.configure({ mode: 'serial' });

test('column title is shared, undo and redo work, and the menu duplicates a note', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signInOwner(page);
  const nell = await join(browser, await createInvite(page, 'member'), 'Pia', 'pia@studio.test');
  const oto = await join(browser, await createInvite(page, 'guest'), 'Rui', 'rui@free.test');

  await nell.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await nell.page.getByRole('link', { name: 'New project' }).click();
  await nell.page.getByLabel('Project name').fill('Tools story');
  await nell.page.getByRole('button', { name: 'Create project' }).click();
  await expect(nell.page.getByRole('heading', { name: 'Tools story' })).toBeVisible();
  await nell.page.getByLabel('Add a person').selectOption({ label: 'Rui (freelancer)' });
  await nell.page.getByRole('button', { name: 'Add to project' }).click();
  await expect(nell.page.getByRole('list', { name: 'Project members' })).toContainText('Rui');

  await nell.page.getByRole('link', { name: 'Open board' }).click();
  await expect(nell.page.getByLabel('Connection')).toHaveText('Live', { timeout: 15_000 });

  // A column: type its title straight away.
  await nell.page.getByRole('button', { name: 'Column', exact: true }).click();
  await nell.page.getByLabel('Column title').fill('Ideas');
  await nell.page.getByText('Drag the background').click();
  await expect(nell.page.getByText('Ideas', { exact: true })).toBeVisible();

  // The other person sees the column and its title.
  await oto.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await oto.page.getByRole('link', { name: /Tools story/ }).click();
  await oto.page.getByRole('link', { name: 'Open board' }).click();
  await expect(oto.page.getByText('Ideas', { exact: true })).toBeVisible({ timeout: 15_000 });

  // A note, then undo removes it and redo brings it back.
  await nell.page.getByRole('button', { name: 'Note', exact: true }).click();
  await nell.page.getByLabel('Note text').fill('Keep me');
  await nell.page.getByText('Drag the background').click();
  await expect(nell.page.getByText('Keep me', { exact: true })).toBeVisible();
  await nell.page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(nell.page.getByText('Keep me', { exact: true })).toHaveCount(0);
  await expect(oto.page.getByText('Keep me', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await nell.page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(nell.page.getByText('Keep me', { exact: true })).toBeVisible();

  // The right-click menu duplicates the note.
  await nell.page.getByText('Keep me', { exact: true }).click({ button: 'right' });
  await nell.page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(nell.page.getByText('Keep me', { exact: true })).toHaveCount(2);

  await oto.context.close();
  await nell.context.close();
});
