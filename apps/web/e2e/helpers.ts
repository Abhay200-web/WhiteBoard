import { expect, type Browser, type Page } from '@playwright/test';

// Shared by the E2E specs. smoke.spec.ts creates the workspace and this owner first.

const BASE = 'http://127.0.0.1:5173';
const OWNER = { email: 'owner@studio.test', password: 'correct-horse-battery' };
const PASSWORD = 'a-long-new-password';

export async function signInOwner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
}

/** As the signed-in owner: creates an invite and returns its code. Guests get 30 days. */
export async function createInvite(page: Page, role: 'member' | 'guest'): Promise<string> {
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

/** Someone joins with the code in their own browser ("another PC") and lands on Home. */
export async function join(browser: Browser, code: string, name: string, email: string) {
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
