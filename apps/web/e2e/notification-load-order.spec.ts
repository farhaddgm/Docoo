import { expect, test } from '@playwright/test';

import { notificationMessages } from '../app/[locale]/notifications/notification-messages';

const text = notificationMessages('fa');
const workspaceId = '33333333-3333-4333-8333-333333333333';

for (const staleStatus of [200, 503]) {
  test(`notification filter ignores an older unread response (${staleStatus})`, async ({
    page,
  }) => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const json = (body: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session')
        return json({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'synthetic@example.test',
            displayName: 'Synthetic test',
            role: 'super_admin',
          },
          workspaces: [
            { id: workspaceId, code: 'synthetic', name: 'Synthetic', role: 'super_admin' },
          ],
        });
      if (url.pathname === `/api/workspaces/${workspaceId}/notifications`) {
        if (url.searchParams.get('status') === 'unread') {
          entered();
          await held;
          return json({ items: [], nextCursor: null }, staleStatus);
        }
        return json({
          items: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              kind: 'gate_review',
              projectId: null,
              project: { code: 'synthetic-latest-filter', title: 'Synthetic notification' },
              createdAt: '2026-10-15T00:00:00Z',
              readAt: '2026-10-15T00:01:00Z',
              stillWaiting: true,
            },
          ],
          nextCursor: null,
        });
      }
      if (url.pathname.endsWith('/notifications/summary')) return json({ unread: 0 });
      return json({}, 404);
    });
    try {
      await page.goto('/fa/notifications');
      await requested;
      await page.getByLabel(text.filter).selectOption('all');
      const row = page
        .getByRole('list', { name: text.title })
        .locator('li')
        .filter({ hasText: 'synthetic-latest-filter' });
      await expect(row.getByText(text.read, { exact: true })).toBeVisible();
      const stale = page.waitForResponse(
        (response) => new URL(response.url()).searchParams.get('status') === 'unread',
      );
      release();
      await stale;
      // Give the old fetch continuation and React commit two actual animation frames.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(row.getByText(text.read, { exact: true })).toBeVisible();
      await expect(page.getByLabel(text.filter)).toHaveValue('all');
      await expect(page.getByRole('alert').filter({ hasText: text.loadFailed })).toHaveCount(0);
    } finally {
      release();
    }
  });
}
