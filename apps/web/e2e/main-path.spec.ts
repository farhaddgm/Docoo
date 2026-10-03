import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const email = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@example.test';
const password = process.env['E2E_ADMIN_PASSWORD'] ?? 'e2e-admin-password-1';

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

async function signInWithKeyboard(page: Page) {
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
    await expect(page.getByRole('heading', { level: 1, name: 'ورود ادمین' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'رفتن به محتوای اصلی' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await expectNoSeriousA11yViolations(page);
  });

  test('announces and focuses a failed sign-in', async ({ page }) => {
    await page.goto('/fa');
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

    const heading = page.getByRole('heading', { level: 1, name: 'داشبورد Docoo' });
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
    await expect(page.getByRole('heading', { level: 1, name: 'Docoo dashboard' })).toBeVisible();
    await expect(page.getByText('E2E Admin')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    const signOut = page.getByRole('button', { name: 'Sign out' });
    await signOut.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'signed out' })).toHaveText(
      'You have signed out.',
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Administrator sign in' }),
    ).toBeFocused();

    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Administrator sign in' }),
    ).toBeVisible();
  });

  test('requests a reset link with a generic answer and handles a missing token', async ({
    page,
  }) => {
    await page.goto('/en');
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

    const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
    await nav.getByRole('link', { name: 'Audit Log' }).click();
    await expect(page).toHaveURL(/\/fa\/audit$/u);
    await expect(nav.getByRole('link', { name: 'Audit Log' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('cell', { name: 'knowledge.override' }).first()).toBeVisible();
    await page.getByLabel('شدت').selectOption('critical');
    await page.getByRole('button', { name: 'اعمال فیلتر' }).focus();
    await page.keyboard.press('Enter');
    const results = page.getByRole('heading', { level: 2, name: /نتیجه‌ها/u });
    await expect(results).toBeFocused();
    await expect(page.getByRole('cell', { name: 'project.create' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'knowledge.override' }).first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'خروجی CSV' }).click();
    expect((await download).suggestedFilename()).toBe('docoo-audit.csv');
    await expect(page.getByRole('status').filter({ hasText: 'خروجی آماده شد' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/audit$/u);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Brain report' }).click();
    await page.getByRole('button', { name: 'Generate workspace report' }).click();
    await expect(
      page.getByText('This report did not change any project, setting or output.'),
    ).toBeVisible();
    await expect(page.locator('#report-title')).toBeFocused();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Cost & usage' }).click();
    await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    await page.getByLabel('Group by').selectOption('model');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
