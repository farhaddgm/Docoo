import { test, expect, type Page, type Route } from '@playwright/test';

const workspace = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'test',
  name: 'Test workspace',
  role: 'super_admin',
};
const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@gmail.com',
  displayName: 'Owner',
  role: 'super_admin',
  loginMethod: 'GOOGLE',
  hasPassword: false,
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function signInAs(page: Page, isOwner: boolean) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session')
      return json(route, { user: { ...admin, isOwner }, workspaces: [workspace] });
    return json(route, { items: [], rows: [], connection: null });
  });
}

const ownerPages = ['/fa/providers', '/fa/settings', '/fa/agents'];

test('an administrator who is not the owner does not see the owner pages', async ({ page }) => {
  await signInAs(page, false);
  await page.goto('/fa/projects');
  const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
  for (const name of ['ارائه‌دهندگان AI', 'اتصال‌ها', 'تنظیمات سامانه', 'Audit Log', 'ایجنت‌ها']) {
    await expect(nav.getByRole('link', { name })).toHaveCount(0);
  }
  await expect(nav.getByRole('link', { name: 'پروژه‌ها' })).toBeVisible();
  for (const path of ownerPages) {
    await page.goto(path);
    await expect(page.locator('p[role=alert]')).toHaveText(
      'این صفحه فقط برای مالک سامانه در دسترس است.',
      { timeout: 20_000 },
    );
    await expect(page.locator('.owner-badge')).toHaveCount(0);
  }
});

test('the owner sees the owner pages with an owner badge', async ({ page }) => {
  await signInAs(page, true);
  await page.goto('/fa/projects');
  const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
  await expect(nav.getByRole('link', { name: 'ارائه‌دهندگان AI' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'ایجنت‌ها' })).toBeVisible();
  for (const path of ownerPages) {
    await test.step(path, async () => {
      // A cold Firefox sometimes loses the first load of a page; load it again until it shows.
      await expect(async () => {
        await page.goto(path);
        await expect(page.getByRole('img', { name: 'فقط مالک', exact: true })).toBeVisible({
          timeout: 6_000,
        });
      }).toPass({ timeout: 45_000 });
    });
  }
});
