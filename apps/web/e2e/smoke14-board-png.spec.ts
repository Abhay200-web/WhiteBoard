import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { signInOwner } from './helpers';

// Phase C step 5, the board as a PNG, through the real UI: a board with a note and a column
// downloads as a picture. Runs after smoke13-export.spec.ts.
test.describe.configure({ mode: 'serial' });

test('a board downloads as a PNG picture', async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page);

  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Picture story');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Picture story' })).toBeVisible();

  await page.getByRole('link', { name: 'Open board' }).click();
  await expect(page.getByLabel('Connection')).toHaveText('Live', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByLabel('Note text').fill('Draw me');
  await page.getByText('Drag the background').click();
  await page.getByRole('button', { name: 'Column', exact: true }).click();
  await page.getByLabel('Column title').fill('Ideas');
  await page.getByText('Drag the background').click();
  await expect(page.getByText('Ideas', { exact: true })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/ - board\.png$/);
  const bytes = readFileSync((await file.path())!);
  // Every PNG starts with these eight bytes.
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Both cards are added at the middle of the view, so the picture is the wider one (the
  // 260-wide column) plus a 40 margin each side, drawn twice as large: 680 pixels.
  expect(bytes.readUInt32BE(16)).toBe(680);
});
