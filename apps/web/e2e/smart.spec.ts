import { expect, test, type Page } from '@playwright/test';

import { expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

/**
 * Smart (SMT-001..004) in the browser: accessible window and pages, a browser error that is
 * recorded and opened from its toast, and the on/off switch. The chat needs a model, so it is
 * covered by the API integration tests.
 */
test.describe('Smart in Persian and English (SMT-001..004)', () => {
  // One sign-in for the whole group keeps clear of the login rate limit (10 per minute).
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL;
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    page = await context.newPage();
    await signInWithKeyboard(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('opens the window, walks its tabs and stays accessible', async () => {
    await page.goto('/fa');
    await page.evaluate(() => window.localStorage.removeItem('docoo.smart.ui'));
    await page.reload();

    const toggle = page.getByRole('button', { name: /^اسمارت/ });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'باز کردن اسمارت' }).click();

    const panel = page.getByRole('complementary', { name: 'پنجرهٔ اسمارت' });
    await expect(panel).toBeVisible();
    // The walker shows a step of 12 and says what to do (which step depends on earlier tests).
    await expect(panel.getByText(/^مرحلهٔ .+ از ۱۲$/)).toBeVisible();
    await expect(panel.getByRole('heading', { level: 3 })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'چه کار کنم؟' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    for (const tab of ['گفتگو', 'خطاها']) {
      await panel.getByRole('tab', { name: tab }).click();
      await expect(panel.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await expectNoSeriousA11yViolations(page);
    }

    // Escape collapses the window to the round button, state is kept for the next page.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'باز کردن اسمارت' })).toBeVisible();
  });

  test('records a browser error, toasts it and opens its details', async () => {
    await page.goto('/fa');
    await page.evaluate(() => window.localStorage.removeItem('docoo.smart.ui'));
    // Letters only: the tracker groups errors after normalising numbers, so a digit-free random
    // text keeps every run a new group.
    const token = Array.from({ length: 14 }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    ).join('');
    const message = `E2E smart error ${token}`;
    await page.evaluate((text) => {
      setTimeout(() => {
        throw new Error(text);
      }, 0);
    }, message);

    const toast = page.getByRole('region', { name: 'اعلان‌های اسمارت' });
    await expect(toast.getByText(message)).toBeVisible();
    await toast.getByRole('button', { name: 'جزئیات' }).click();

    const panel = page.getByRole('complementary', { name: 'پنجرهٔ اسمارت' });
    await expect(panel.getByRole('tab', { name: 'خطاها' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.getByText(message).first()).toBeVisible();
    await expect(panel.getByText('رابط کاربری').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('the two full pages work in both languages', async () => {
    await page.goto('/fa/smart/errors');
    await expect(page.getByRole('heading', { level: 1, name: 'خطایاب' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'ناوبری اصلی' }).getByRole('link', { name: 'اسمارت' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousA11yViolations(page);

    await page.goto('/en/smart/issues');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Walker issue ledger' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Smart' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousA11yViolations(page);
  });

  test('switching Smart off hides the window and toasts', async () => {
    await page.goto('/fa');
    await page.evaluate(() =>
      window.localStorage.setItem(
        'docoo.smart.ui',
        JSON.stringify({ enabled: true, minimized: false, side: 'end', tab: 'walker' }),
      ),
    );
    await page.reload();
    const panel = page.getByRole('complementary', { name: 'پنجرهٔ اسمارت' });
    await expect(panel).toBeVisible();

    await page.getByRole('button', { name: /^اسمارت/ }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'باز کردن اسمارت' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^اسمارت/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
