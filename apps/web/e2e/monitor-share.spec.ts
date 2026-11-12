import { expect, test } from '@playwright/test';

import { apiSession, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const PASSWORD = 'room-screen-password';

/**
 * A share link of the viewer monitor (ADR-0056): the owner makes it from the monitor page, a
 * visitor with no account opens it, gives the password and sees the screen, and the owner ends it.
 */
test.describe('monitor share link', () => {
  test('the owner makes a link, a visitor opens it with the password, and revoking ends it', async ({
    page,
    browser,
  }) => {
    await signInWithKeyboard(page);
    const { workspaceId, headers } = await apiSession(page);
    const setting = (key: string, value: boolean) =>
      page.request.put(`/api/workspaces/${workspaceId}/settings/assignments`, {
        headers,
        data: {
          key,
          scopeType: 'workspace',
          scopeId: workspaceId,
          value,
          reason: 'e2e share link',
        },
      });
    for (const key of ['monitor.disclosure_accepted', 'monitor.viewer.enabled']) {
      expect((await setting(key, true)).ok()).toBe(true);
    }

    try {
      await page.goto('/fa/monitor');
      await page.getByLabel('رمز (حداقل ۸ نویسه)').fill(PASSWORD);
      await page.getByLabel('برچسب (اختیاری)').fill('سالن جلسه');
      await page.getByRole('button', { name: 'ساخت لینک' }).click();
      await expect(page.getByText('لینک ساخته شد')).toBeVisible();
      const address = await page.locator('input[readonly]').inputValue();
      expect(address).toMatch(/\/fa\/monitor\/share\/[A-Za-z0-9_-]{43}$/u);

      // A visitor in a browser with no sign-in at all.
      const visitor = await browser.newContext();
      try {
        const screen = await visitor.newPage();
        await screen.goto(address);
        const field = screen.getByLabel('رمز', { exact: true });
        await expect(field).toBeVisible();
        // Nothing of the work is on the page before the password.
        await expect(screen.getByText('پخش زنده')).toHaveCount(0);
        await expectNoSeriousA11yViolations(screen);
        expect(await screen.locator('meta[name=robots]').getAttribute('content')).toContain(
          'noindex',
        );

        await field.fill('not the password');
        await screen.getByRole('button', { name: 'نمایش' }).click();
        await expect(screen.getByText('رمز درست نیست')).toBeVisible();

        await field.fill(PASSWORD);
        await screen.getByRole('button', { name: 'نمایش' }).click();
        await expect(screen.getByText('پخش زنده')).toBeVisible();

        // The owner revokes the link; the screen stops within a refresh.
        await page.reload();
        await page.getByRole('button', { name: 'لغو' }).first().click();
        await expect(screen.getByText('این لینک دیگر معتبر نیست.')).toBeVisible({
          timeout: 20_000,
        });
      } finally {
        await visitor.close();
      }
    } finally {
      for (const key of ['monitor.viewer.enabled', 'monitor.disclosure_accepted']) {
        await setting(key, false);
      }
    }
  });
});
