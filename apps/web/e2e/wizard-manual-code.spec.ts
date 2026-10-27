import { expect, test } from '@playwright/test';

const workspaceId = '33333333-3333-4333-8333-333333333333';
for (const locale of ['fa', 'en'] as const) {
  test(`manual project code survives rapid title edits and late catalog loading (${locale})`, async ({
    page,
  }) => {
    let releaseCatalog!: () => void;
    const catalog = new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = { items: [] };
      if (path === '/api/auth/session')
        body = {
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            role: 'super_admin',
            displayName: 'Owner',
            isOwner: true,
          },
          workspaces: [{ id: workspaceId, code: 'test', name: 'Test', role: 'super_admin' }],
        };
      if (path.endsWith('/settings/preview')) body = { config: { values: {}, sources: {} } };
      if (path.endsWith('/notifications/summary')) body = { unread: 0 };
      if (path.endsWith('/projects/problem-pattern-versions')) await catalog;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto(`/${locale}/projects/new`);
    const code = page.locator('#project-code');
    const title = page.locator('#project-title');
    await expect(code).toBeEnabled();
    await code.fill('biz-manual-identity');
    await title.fill('A different suggested title');
    releaseCatalog();
    await expect(code).toHaveValue('biz-manual-identity');
    // One task exercises consecutive native input events before React commits a render.
    await page.evaluate(() => {
      const input = (id: string, value: string) => {
        const element = document.getElementById(id) as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          element,
          value,
        );
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      input('project-code', 'biz-second-identity');
      input('project-title', 'Another automatic suggestion');
      input('project-title', 'Final automatic suggestion');
    });
    await expect(code).toHaveValue('biz-second-identity');
    await page.reload();
    await expect(code).toHaveValue('biz-second-identity');
    await expect(title).toHaveValue('Final automatic suggestion');
    await title.fill('Changed after restoring the draft');
    await expect(code).toHaveValue('biz-second-identity');
  });
}
