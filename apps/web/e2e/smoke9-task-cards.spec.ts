import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInOwner } from './helpers';

// Step B5 through the real UI against a real Host: a task is put on the board, a column is linked to
// the "In progress" status, and dropping the task card into that column moves the task on the kanban.
// Runs after smoke8-board-tools.spec.ts. Uses the owner as the manager, so the move is allowed.
test.describe.configure({ mode: 'serial' });

/** Drags an element to a point on the page, with the mouse, in steps (as a person would). */
async function dragPoint(page: Page, from: Locator, x: number, y: number) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

/** Drags an element to the centre of another, with the mouse, in steps (as a person would). */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('a task dropped on a column linked to a status moves the task on the kanban', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInOwner(page);

  // A project with one task, and its board.
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Task board story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Task board story' })).toBeVisible();
  await page.getByLabel('New task title').fill('Logo concepts');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('link', { name: 'Open board' }).click();
  await expect(page.getByLabel('Connection')).toHaveText('Live', { timeout: 15_000 });

  // A column linked to "In progress".
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column title').fill('Doing');
  await page.getByText('Drag the background').click();
  await page.getByText('Doing', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Link to In progress' }).click();
  await expect(page.getByText('Tasks dropped here become: In progress')).toBeVisible();

  // The task goes on the board. It starts in "To do".
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByRole('button', { name: 'Logo concepts' }).click();
  const card = page.locator('[data-item]').filter({ hasText: 'Logo concepts' });
  await expect(card).toContainText('To do');

  // Away from the column, then into it: the first drop changes nothing, the second moves the task.
  const column = page.locator('[data-item]').filter({ hasText: 'Doing' }).first();
  const canvas = (await page.getByRole('region', { name: 'Board canvas' }).boundingBox())!;
  await dragPoint(page, card, canvas.x + 60, canvas.y + 60);
  await expect(card).toContainText('To do');
  await dragTo(page, card, column);
  await expect(card).toContainText('In progress', { timeout: 15_000 });

  // The kanban shows the task under "In progress".
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: /Task board story/ }).click();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Logo concepts');
});
