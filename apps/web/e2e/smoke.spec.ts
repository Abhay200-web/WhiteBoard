import { expect, test } from '@playwright/test';

// Runs against a fresh Host (empty data dir), in order: each step depends on the previous one.
test.describe.configure({ mode: 'serial' });

const OWNER = { email: 'owner@studio.test', password: 'correct-horse-battery' };

test('a new Host starts at the setup wizard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Set up Whiteboard' })).toBeVisible();
});

test('the owner sets up the workspace and lands signed in', async ({ page }) => {
  await page.goto('/setup');
  await page.getByLabel('Workspace name').fill('Studio');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByLabel('Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/); // setup is closed for good
});

test('sign out, wrong password is refused, right password signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill('wrong-wrong-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong email or password');

  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('owner invites a member, they join from another PC, removal ends their session', async ({
  page,
  browser,
}) => {
  // Owner creates an invite.
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByRole('button', { name: 'Create invite' }).click();
  const code = (await page.getByLabel('Invite code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.getByRole('button', { name: 'Done' }).click();

  // A different browser (= another PC) joins with the code.
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const mia = await other.newPage();
  await mia.goto(`/join?code=${code}`);
  await mia.getByLabel('Your name').fill('Mia');
  await mia.getByLabel('Email').fill('mia@studio.test');
  await mia.getByLabel('Password', { exact: true }).fill('a-long-new-password');
  await mia.getByLabel('Confirm password').fill('a-long-new-password');
  await mia.getByRole('button', { name: 'Create account' }).click();
  await expect(mia.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(mia.getByRole('link', { name: 'Members' })).toHaveCount(0); // not an admin
  await mia.goto('/members');
  await expect(mia).not.toHaveURL(/\/members$/);

  // The code cannot be reused.
  const third = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const reuse = await third.newPage();
  await reuse.goto(`/join?code=${code}`);
  await reuse.getByLabel('Your name').fill('Eve');
  await reuse.getByLabel('Email').fill('eve@studio.test');
  await reuse.getByLabel('Password', { exact: true }).fill('another-long-password');
  await reuse.getByLabel('Confirm password').fill('another-long-password');
  await reuse.getByRole('button', { name: 'Create account' }).click();
  await expect(reuse.getByRole('alert')).toContainText('not valid or has expired');
  await third.close();

  // Owner removes Mia: her open session dies on her next request.
  await page.reload();
  await page.getByRole('button', { name: 'Remove Mia' }).click();
  await page.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByText('mia@studio.test')).toHaveCount(0);
  await mia.reload();
  await expect(mia).toHaveURL(/\/login$/);
  await other.close();
});
