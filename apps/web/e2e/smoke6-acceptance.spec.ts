import { deflateSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

import { createInvite, join, signInOwner } from './helpers';

// Step 5.10: PRODUCT_SPEC section 13 through the real UI against a real Host, as far as a browser
// reaches. Runs last, after smoke5-pins.spec.ts, on the same Host (so names here are its own).
// Not covered here: step 1's first-run wizard (smoke.spec.ts does it), step 5's Windows toast,
// step 11's time-shifted reminders (server job tests cover them), step 13's restore onto a spare
// PC, and step 14's Host restart. Those are checked by hand on the three office PCs.
test.describe.configure({ mode: 'serial' });

const PROJECT = 'Studio acceptance: Logo for Client X';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

/**
 * A plain 320 x 240 PNG (grey). The 1x1 image above renders at 3 x 3 pixels, so two pins
 * would land on the same 24-pixel marker. Written here because a PNG is a zlib stream plus CRCs.
 */
function bigPng(width = 320, height = 240): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit grey, no interlace
  const rows = Buffer.alloc((width + 1) * height, 0x90); // filter byte 0, then grey pixels
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const BIG_PNG = bigPng();

/** Local `YYYY-MM-DDTHH:mm` for 17:00, `days` from now (the Due field's format). */
function dueIn(days: number) {
  const due = new Date(Date.now() + days * 86_400_000);
  due.setHours(17, 0, 0, 0);
  return new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

test('section 13: the Logo for Client X story, as far as a browser reaches', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);
  let managerCode = '';
  let artistCode = '';
  // Set by step 2, which always runs first (the steps are serial and in order).
  let manager!: Awaited<ReturnType<typeof join>>;
  let artist!: Awaited<ReturnType<typeof join>>;
  let projectUrl = '';

  // 1. The owner invites a manager (a member) and an artist (a freelancer).
  await test.step('1. the owner creates invites for a manager and an artist', async () => {
    await signInOwner(page);
    managerCode = await createInvite(page, 'member');
    artistCode = await createInvite(page, 'guest');
  });

  // 2. Each joins from another PC. The artist sees no projects yet.
  await test.step('2. the manager and the artist join from their own PCs', async () => {
    manager = await join(browser, managerCode, 'Max', 'max@studio.test');
    artist = await join(browser, artistCode, 'Ari', 'ari@free.test');
    await artist.page.getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(artist.page.getByRole('link', { name: PROJECT })).toHaveCount(0);
  });

  // 3. The manager creates the project: brief, deadline in 7 days, 3 reference images, a PDF.
  await test.step('3. the manager creates the project with a brief and files', async () => {
    const p = manager.page;
    await p.getByRole('link', { name: 'Projects', exact: true }).click();
    await p.getByRole('link', { name: 'New project' }).click();
    await p.getByLabel('Project name').fill(PROJECT);
    await p.getByLabel('Client (optional)').fill('Client X');
    await p
      .getByLabel('Deadline')
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    await p.getByRole('textbox', { name: 'Brief' }).click();
    await p.keyboard.type('Clean, bold wordmark. Two colours at most.');
    const files = [
      { name: 'ref-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'ref-2.png', mimeType: 'image/png', buffer: PNG },
      { name: 'ref-3.png', mimeType: 'image/png', buffer: PNG },
      { name: 'brief.pdf', mimeType: 'application/pdf', buffer: PDF },
    ];
    await p.getByLabel(/Choose files/).setInputFiles(files);
    await expect(p.getByRole('list', { name: 'Files to attach' })).toContainText('brief.pdf');
    await p.getByRole('button', { name: 'Create project' }).click();

    await expect(p.getByRole('heading', { name: PROJECT })).toBeVisible();
    await expect(p.getByText('Clean, bold wordmark. Two colours at most.')).toBeVisible();
    await expect(p.getByRole('list', { name: 'Project files' })).toContainText('ref-3.png');
    projectUrl = p.url();
  });

  // 4. The manager adds the artist and creates "Logo concepts": High, due in 3 days, assigned.
  await test.step('4. the manager adds the artist and assigns "Logo concepts"', async () => {
    const p = manager.page;
    await p.getByLabel('Add a person').selectOption({ label: 'Ari (freelancer)' });
    await p.getByRole('button', { name: 'Add to project' }).click();
    await expect(p.getByRole('list', { name: 'Project members' })).toContainText('Ari');

    await p.getByLabel('New task title').fill('Logo concepts');
    await p.getByRole('button', { name: 'Add task' }).click();
    await p.getByRole('button', { name: 'Logo concepts' }).click();
    const drawer = p.getByRole('dialog', { name: 'Logo concepts' });
    await drawer.getByLabel('Priority').selectOption('High');
    await drawer.getByLabel('Due').fill(dueIn(3));
    await drawer.getByRole('checkbox', { name: 'Ari' }).click();
    await expect(drawer.getByRole('checkbox', { name: 'Ari' })).toBeChecked();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  // 5. The artist hears about it live, reads the brief and files, and asks a question with @Max.
  await test.step('5. the artist is notified, reads the brief, asks @Max a question', async () => {
    const a = artist.page;
    await expect(a.getByRole('button', { name: /^Notifications, \d+ unread$/ })).toBeVisible();

    // A fresh load: this tab listed projects in step 2, before the project existed, and the app
    // reuses list data younger than 5 s. A person is never that fast.
    await a.goto('/projects');
    await a.getByRole('link', { name: PROJECT }).click({ timeout: 15_000 });
    await expect(a.getByText('Clean, bold wordmark. Two colours at most.')).toBeVisible();
    await expect(a.getByRole('list', { name: 'Project files' })).toContainText('brief.pdf');

    await a.getByRole('link', { name: 'My tasks' }).click();
    await a.getByRole('button', { name: 'Logo concepts', exact: true }).click();
    const drawer = a.getByRole('dialog', { name: 'Logo concepts' });
    await drawer.getByLabel('New comment').pressSequentially('Which colours, @Ma');
    await drawer.getByRole('button', { name: '@Max' }).click();
    await drawer.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(drawer.getByRole('list', { name: 'Comments' })).toContainText(
      'Which colours, @Max',
    );
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  // 6. The manager replies, and the artist moves the task to In progress.
  await test.step('6. the manager replies; the artist moves the task to In progress', async () => {
    const m = manager.page;
    await m.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
    await expect(m.getByRole('region', { name: 'Notifications' })).toContainText(
      'Ari mentioned you on Logo concepts',
    );
    await m.keyboard.press('Escape');
    await m.goto(new URL(projectUrl).pathname);
    await m.getByRole('button', { name: 'Logo concepts' }).click();
    const drawer = m.getByRole('dialog', { name: 'Logo concepts' });
    await drawer.getByLabel('New comment').fill('Two colours, see the brief');
    await drawer.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(drawer.getByRole('list', { name: 'Comments' })).toContainText(
      'Two colours, see the brief',
    );
    await drawer.getByRole('button', { name: 'Close' }).click();

    const a = artist.page;
    await a.goto('/my-tasks');
    await a.getByRole('button', { name: 'Logo concepts', exact: true }).click();
    const aDrawer = a.getByRole('dialog', { name: 'Logo concepts' });
    await aDrawer.getByLabel('Status').selectOption('In progress');
    await aDrawer.getByRole('button', { name: 'Close' }).click();
    await a.goto(new URL(projectUrl).pathname);
    await a.getByRole('button', { name: 'Board' }).click();
    await expect(a.getByRole('region', { name: 'In progress' })).toContainText('Logo concepts');
  });

  // 7. The artist uploads concepts-v1.png, which sends it for review.
  await test.step('7. the artist uploads concepts-v1.png and sends it for review', async () => {
    const a = artist.page;
    await a.getByRole('button', { name: 'Logo concepts', exact: true }).click();
    const drawer = a.getByRole('dialog', { name: 'Logo concepts' });
    await drawer.getByLabel('New deliverable name').fill('Logo concepts');
    await drawer.getByLabel(/Choose a file/).setInputFiles({
      name: 'concepts-v1.png',
      mimeType: 'image/png',
      buffer: BIG_PNG,
    });
    await expect(drawer.getByRole('list', { name: 'Versions of Logo concepts' })).toContainText(
      'v1',
    );
    await drawer.getByRole('button', { name: 'Close' }).click();

    await manager.page.goto(new URL(projectUrl).pathname);
    await expect(manager.page.getByRole('region', { name: 'In review' })).toContainText(
      'Logo concepts',
    );
  });

  // 8. The manager reviews it, drops two pins, and requests changes with a summary.
  await test.step('8. the manager drops two pins and requests changes', async () => {
    const m = manager.page;
    await m.goto('/review-queue');
    await m.getByRole('link', { name: 'Review', exact: true }).click();
    // The pin layer covers the image, so a forced click lands on it, at two different spots.
    const image = m.getByRole('img', { name: 'concepts-v1.png' });
    const box = (await image.boundingBox())!;
    await image.click({ force: true, position: { x: box.width * 0.25, y: box.height * 0.25 } });
    await expect(m.getByRole('button', { name: 'Pin 1, open' })).toBeVisible();
    await m.getByLabel('Reply').fill('Make the logo bigger');
    await m.getByRole('button', { name: 'Reply' }).click();
    await expect(m.getByText('Make the logo bigger', { exact: true })).toBeVisible();

    // The thread panel opened with pin 1 may have narrowed the image: measure it again.
    const shown = (await image.boundingBox())!;
    await image.click({ force: true, position: { x: shown.width * 0.75, y: shown.height * 0.75 } });
    await expect(m.getByRole('button', { name: 'Pin 2, open' })).toBeVisible();
    await m.getByLabel('Reply').fill('Use the darker blue');
    await m.getByRole('button', { name: 'Reply' }).click();
    await expect(m.getByText('Use the darker blue', { exact: true })).toBeVisible();

    await m.getByLabel('Summary for the artist').fill('The logo needs to be bigger and bluer');
    await m.getByRole('button', { name: 'Request changes' }).click();
    await expect(m.getByText('Nothing is waiting for review on this task.')).toBeVisible();
  });

  // 9. The artist is notified, resolves both pins, and sends concepts-v2.png.
  await test.step('9. the artist resolves both pins and sends concepts-v2.png', async () => {
    const a = artist.page;
    await a.goto('/my-tasks');
    await expect(a.getByRole('button', { name: /^Notifications, \d+ unread$/ })).toBeVisible();
    await a.getByRole('button', { name: 'Logo concepts', exact: true }).click();
    const drawer = a.getByRole('dialog', { name: 'Logo concepts' });
    await expect(drawer).toContainText('The logo needs to be bigger and bluer');
    await drawer.getByRole('button', { name: 'Preview and pins' }).click();

    await a.getByRole('button', { name: 'Pin 1, open' }).click();
    await expect(a.getByText('Make the logo bigger', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Resolve' }).click();
    await expect(a.getByRole('button', { name: 'Reopen' })).toBeVisible();

    await a.getByRole('button', { name: 'Pin 2, open' }).click();
    await expect(a.getByText('Use the darker blue', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Resolve' }).click();
    await expect(a.getByRole('button', { name: 'Reopen' })).toBeVisible();

    // Back on the drawer: send version 2.
    await drawer.getByRole('button', { name: 'Close' }).click();
    await a.getByRole('button', { name: 'Logo concepts', exact: true }).click();
    const again = a.getByRole('dialog', { name: 'Logo concepts' });
    await again.getByLabel('Deliverable', { exact: true }).selectOption('Logo concepts');
    await again.getByLabel(/Choose a file/).setInputFiles({
      name: 'concepts-v2.png',
      mimeType: 'image/png',
      buffer: BIG_PNG,
    });
    await expect(again.getByRole('list', { name: 'Versions of Logo concepts' })).toContainText(
      'v2',
    );
    await again.getByRole('button', { name: 'Close' }).click();
  });

  // 10. The manager compares v1 and v2, then approves. The task moves to Approved.
  await test.step('10. the manager compares v1 and v2 and approves', async () => {
    const m = manager.page;
    await m.goto(new URL(projectUrl).pathname);
    await m.getByRole('button', { name: 'Logo concepts' }).click();
    const drawer = m.getByRole('dialog', { name: 'Logo concepts' });
    await drawer.getByRole('link', { name: 'Compare versions' }).click();
    await expect(m.getByRole('heading', { name: 'Compare Logo concepts' })).toBeVisible();
    await expect(m.getByRole('img', { name: 'concepts-v1.png' })).toBeVisible();
    await expect(m.getByRole('img', { name: 'concepts-v2.png' })).toBeVisible();

    await m.goto('/review-queue');
    await m.getByRole('link', { name: 'Review', exact: true }).click();
    await expect(m.getByText('Logo concepts v2')).toBeVisible();
    await m.getByRole('button', { name: 'Approve' }).click();
    await expect(m.getByText('Nothing is waiting for review on this task.')).toBeVisible();

    // The board moves the card to Approved; the history names who did each step.
    await m.goto(new URL(projectUrl).pathname);
    await expect(m.getByRole('region', { name: 'Approved' })).toContainText('Logo concepts');
    await m.getByRole('button', { name: 'Logo concepts' }).click();
    const done = m.getByRole('dialog', { name: 'Logo concepts' });
    await done.getByText(/^History/).click();
    const history = done.getByRole('list', { name: 'History' });
    await expect(history).toContainText('Max approved Logo concepts v2');
    await expect(history).toContainText('Ari sent Logo concepts v1 for review');
    await expect(history).toContainText('Ari moved it from To do to In progress');
    await done.getByRole('button', { name: 'Close' }).click();
  });

  // 12. The artist is removed. Her open task goes to someone else, and she loses access at once.
  await test.step('12. removing the artist hands her open task over and ends her access', async () => {
    const m = manager.page;
    // Open task for the artist, so the removal has something to hand over.
    await m.getByLabel('New task title').fill('Social cut-downs');
    await m.getByRole('button', { name: 'Add task' }).click();
    await m.getByRole('button', { name: 'Social cut-downs' }).click();
    const drawer = m.getByRole('dialog', { name: 'Social cut-downs' });
    await drawer.getByRole('checkbox', { name: 'Ari' }).click();
    await expect(drawer.getByRole('checkbox', { name: 'Ari' })).toBeChecked();
    await drawer.getByRole('button', { name: 'Close' }).click();

    // Only the owner can remove members. A fresh load, not the cached list.
    await page.goto('/members');
    await page.getByRole('button', { name: 'Remove Ari' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove Ari?' });
    await dialog.getByLabel('Give Social cut-downs to').selectOption('Max');
    await dialog.getByRole('button', { name: 'Remove member' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await artist.page.reload();
    await expect(artist.page).toHaveURL(/\/login$/);
  });

  // 13. The owner runs Backup now. Restoring it onto a spare PC is checked by hand.
  await test.step('13. the owner runs Backup now and sees it listed', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: 'Host' }).click();
    await page.getByRole('button', { name: 'Backup now' }).click();
    await expect(page.getByRole('list', { name: 'Recent backups' })).toContainText('Manual');
  });

  await manager.context.close();
  await artist.context.close();
});
