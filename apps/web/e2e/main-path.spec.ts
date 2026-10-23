import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations, revealRow } from './support';

const email = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@example.test';
const password = process.env['E2E_ADMIN_PASSWORD'] ?? 'e2e-admin-password-1';

async function signInWithKeyboard(page: Page) {
  await page.goto('/fa/auth/login-up');
  await page.getByLabel('ایمیل').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

test.describe('main path in Persian and English (UX-001, AUTH-001)', () => {
  test('renders RTL Persian, skip link first in tab order and accessible login', async ({
    page,
  }) => {
    await page.goto('/fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.getByRole('heading', { level: 1, name: 'ورود به Docoo' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'رفتن به محتوای اصلی' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await expectNoSeriousA11yViolations(page);
  });

  test('announces and focuses a failed sign-in', async ({ page }) => {
    await page.goto('/fa/auth/login-up');
    await page.getByLabel('ایمیل').fill(email);
    await page.getByLabel('گذرواژه').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'ورود' }).click();
    const alert = page.locator('#login-error');
    await expect(alert).toHaveAttribute('role', 'alert');
    await expect(alert).toHaveText('ایمیل یا گذرواژه درست نیست.');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel('گذرواژه')).toHaveAttribute('aria-invalid', 'true');
  });

  test('signs in by keyboard, keeps the session across languages and signs out', async ({
    page,
  }) => {
    await page.goto('/fa');
    await signInWithKeyboard(page);

    const heading = page.getByRole('heading', { level: 1, name: 'نمای کلی' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
    await expect(nav.getByRole('link', { name: 'داشبورد' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByText('پروژه‌ها')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByText('E2E Admin')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Signing out lives in the menu of the profile button at the bottom of the sidebar.
    await page.getByRole('button', { name: /^Account menu: / }).click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out', exact: true });
    await expect(signOut).toBeVisible();
    await signOut.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'signed out' })).toHaveText(
      'You have signed out.',
    );
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Docoo' })).toBeFocused();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Docoo' })).toBeVisible();
  });

  test('requests a reset link with a generic answer and handles a missing token', async ({
    page,
  }) => {
    await page.goto('/en/auth/login-up');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/en\/forgot-password$/);
    await page.getByLabel('Email').fill(`unknown-${Date.now()}@example.test`);
    await page.getByRole('button', { name: 'Send link' }).click();
    const status = page.getByRole('status').filter({ hasText: 'If this email belongs' });
    await expect(status).toBeVisible();
    await expect(status).toBeFocused();

    await page.goto('/fa/reset-password');
    await expect(page.getByText('پیوند بازنشانی ناقص است')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('reporting pages work by keyboard in both languages (REP-001..004)', async ({ page }) => {
    await page.goto('/fa');
    await signInWithKeyboard(page);
    await expect(
      page.getByRole('heading', { level: 2, name: /منتظر پاسخ یا تأیید/u }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'سلامت ارائه‌دهندگان' }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en$/u);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Brain report' })
      .click();
    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByText('Making a report changes nothing.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Most important points' })).toBeVisible();
    await expect(page.locator('#report-title')).toBeFocused();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Cost & usage' }).click();
    await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    await page.getByLabel('Group by').selectOption('model');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('AI providers page sets the default connection and model (AI-001, AI-003)', async ({
    page,
  }) => {
    await page.goto('/fa');
    await signInWithKeyboard(page);
    await expect(page.getByRole('heading', { level: 1, name: 'نمای کلی' })).toBeVisible();

    // An offline test provider stands in for a real key; the page lists every connection.
    const session = await (await page.request.get('/api/auth/session')).json();
    const workspaceId = session.workspaces[0].id as string;
    const headers = { origin: new URL(page.url()).origin, 'sec-fetch-site': 'same-origin' };
    const created = await page.request.post(`/api/workspaces/${workspaceId}/provider-connections`, {
      headers,
      data: { provider: 'fake', name: `E2E test provider ${Date.now()}` },
    });
    expect(created.status()).toBe(201);
    const connection = (await created.json()).connection as { id: string; name: string };
    await page.request.post(
      `/api/workspaces/${workspaceId}/provider-connections/${connection.id}/models/refresh`,
      { headers },
    );

    const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
    await nav.getByRole('link', { name: 'ارائه‌دهندگان AI' }).click();
    await expect(page).toHaveURL(/\/fa\/providers$/u);
    await revealRow(page, page.getByRole('rowheader', { name: connection.name }));
    // The sticky top bar must not sit over a row when the page is checked.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByLabel('کلید API')).toHaveAttribute('type', 'password');
    await expectNoSeriousA11yViolations(page);

    await page.getByLabel('اتصال', { exact: true }).selectOption(connection.id);
    await page.getByLabel('مدل', { exact: true }).selectOption('fake-standard');
    await page.getByRole('button', { name: 'ذخیرهٔ مدل پیش‌فرض' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ذخیره شد' })).toBeVisible();
    await expect(page.getByText(`${connection.name} · fake-standard`)).toBeVisible();

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'AI providers' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
