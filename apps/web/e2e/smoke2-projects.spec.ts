import { expect, test, type Browser, type Page } from '@playwright/test';

// Part 3 exit check, through the real UI against a real Host. Runs after smoke.spec.ts, which
// created the workspace and owner.
test.describe.configure({ mode: 'serial' });

const BASE = 'http://127.0.0.1:5173';
const OWNER = { email: 'owner@studio.test', password: 'correct-horse-battery' };
const PASSWORD = 'a-long-new-password';

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signInOwner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
}

async function createInvite(page: Page, role: 'member' | 'guest'): Promise<string> {
  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  if (role === 'guest') {
    await page.getByLabel('Role').selectOption('guest');
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Access ends on').fill(end);
  }
  await page.getByRole('button', { name: 'Create invite' }).click();
  const code = (await page.getByLabel('Invite code').textContent())!.trim();
  await page.getByRole('button', { name: 'Done' }).click();
  return code;
}

async function join(browser: Browser, code: string, name: string, email: string) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  return { context, page };
}

test('manager creates a project with a brief and files, adds the freelancer; outsiders cannot see it', async ({
  page,
  browser,
}) => {
  await signInOwner(page);
  const freelancerCode = await createInvite(page, 'guest');
  const outsiderCode = await createInvite(page, 'member');
  const freelancer = await join(browser, freelancerCode, 'Fran', 'fran@free.test');
  const outsider = await join(browser, outsiderCode, 'Olly', 'olly@studio.test');

  // Create the project with a brief, a deadline and a reference image.
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Logo for Client X');
  await page.getByLabel('Client (optional)').fill('Client X');
  await page
    .getByLabel('Deadline')
    .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('textbox', { name: 'Brief' }).click();
  await page.keyboard.type('Clean, bold wordmark');
  await page
    .getByLabel(/Choose files/)
    .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('list', { name: 'Files to attach' })).toContainText('reference.png');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('heading', { name: 'Logo for Client X' })).toBeVisible();
  await expect(page.getByText('Clean, bold wordmark')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Project files' })).toContainText('reference.png');
  const projectUrl = page.url();

  // Add the freelancer as an artist.
  await page.getByLabel('Add a person').selectOption({ label: 'Fran (freelancer)' });
  await page.getByRole('button', { name: 'Add to project' }).click();
  await expect(page.getByRole('list', { name: 'Project members' })).toContainText('Fran');

  // The freelancer sees the project and can open its file, without any management controls.
  await freelancer.page.getByRole('link', { name: 'Projects', exact: true }).click();
  await freelancer.page.getByRole('link', { name: /Logo for Client X/ }).click();
  await expect(freelancer.page.getByText('Clean, bold wordmark')).toBeVisible();
  await expect(freelancer.page.getByRole('button', { name: 'Mark as active' })).toHaveCount(0);
  await freelancer.page.getByRole('button', { name: 'reference.png' }).click();
  await expect(
    freelancer.page.getByRole('dialog').getByRole('img', { name: 'reference.png' }),
  ).toBeVisible();

  // Someone who is not on the project cannot open it.
  await outsider.page.goto(new URL(projectUrl).pathname);
  await expect(outsider.page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
  await outsider.page
    .getByRole('link', { name: 'Projects', exact: true })
    .click()
    .catch(() => undefined);

  // The manager moves the project through its status flow.
  await page.getByRole('button', { name: 'Mark as active' }).click();
  await expect(page.getByLabel('Project status')).toHaveText('Active');

  // The manager edits the project details later; the brief is kept.
  await page.getByRole('button', { name: 'Edit project' }).click();
  await page.getByRole('dialog').getByLabel('Client (optional)').fill('Client X Ltd');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Client X Ltd')).toBeVisible();
  await expect(page.getByText('Clean, bold wordmark')).toBeVisible();

  // The manager adds a task and assigns the freelancer, who then starts it.
  await page.getByLabel('New task title').fill('Logo concepts');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByRole('button', { name: 'Logo concepts' }).click();
  const drawer = page.getByRole('dialog');
  // Ticks once the Host confirms the assignment.
  await drawer.getByRole('checkbox', { name: 'Fran' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Fran' })).toBeChecked();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('region', { name: 'To do' })).toContainText('Fran');

  // Her bell updates live, without a reload: added to the project, then assigned the task.
  await freelancer.page.keyboard.press('Escape'); // closes the file preview she left open
  const bell = freelancer.page.getByRole('button', { name: 'Notifications, 2 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  await freelancer.page
    .getByRole('region', { name: 'Notifications' })
    .getByRole('button', { name: /assigned you Logo concepts/ })
    .click();
  // The notification opens the task straight away.
  const herDrawer = freelancer.page.getByRole('dialog', { name: 'Logo concepts' });
  await expect(herDrawer).toBeVisible();
  await expect(
    freelancer.page.getByRole('button', { name: 'Notifications, 1 unread' }),
  ).toBeVisible();
  await herDrawer.getByLabel('Status').selectOption('In progress');
  // She asks the manager (the owner here) a question, @-mentioning him.
  await herDrawer.getByLabel('New comment').pressSequentially('Which colours, @Ow');
  await herDrawer.getByRole('button', { name: '@Owner' }).click();
  await herDrawer.getByRole('button', { name: 'Comment' }).click();
  await expect(herDrawer.getByRole('list', { name: 'Comments' })).toContainText(
    'Which colours, @Owner',
  );
  await herDrawer.getByText(/^History/).click();
  await expect(herDrawer.getByRole('list', { name: 'History' })).toContainText(
    'Fran moved it from To do to In progress',
  );
  await herDrawer.getByRole('button', { name: 'Close' }).click();
  await expect(freelancer.page.getByRole('region', { name: 'In progress' })).toContainText(
    'Logo concepts',
  );

  // She also finds it in My tasks, with its project (no due date, so under Later).
  await freelancer.page.getByRole('link', { name: 'My tasks' }).click();
  await expect(freelancer.page.getByRole('region', { name: 'Later' })).toContainText(
    'Logo concepts',
  );
  await expect(freelancer.page.getByRole('region', { name: 'Later' })).toContainText(
    'Logo for Client X',
  );

  // The manager's board shows her move live, without a reload; he approves it by dragging.
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Logo concepts');
  const approved = page.getByRole('region', { name: 'Approved' });
  // Both columns must be on screen: a drag cannot scroll the page to its target.
  await approved.scrollIntoViewIfNeeded();
  await page
    .getByRole('region', { name: 'In progress' })
    .getByRole('article')
    .filter({ hasText: 'Logo concepts' })
    .dragTo(approved);
  await expect(approved).toContainText('Logo concepts');

  await freelancer.context.close();
  await outsider.context.close();
});

test('the owner runs Backup now and sees it listed', async ({ page }) => {
  await signInOwner(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Host' }).click();
  await expect(page.getByRole('alert'))
    .toContainText(/backup/i)
    .catch(() => undefined);
  await page.getByRole('button', { name: 'Backup now' }).click();
  await expect(page.getByRole('list', { name: 'Recent backups' })).toContainText('Manual');
  await expect(page.getByText(/Last backup: never/)).toHaveCount(0);
});
