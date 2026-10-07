import { test, expect, type Page, type Route } from '@playwright/test';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const userId = '11111111-1111-4111-8111-111111111111';
const workspace = { id: workspaceId, code: 'test', name: 'Test workspace', role: 'super_admin' };
const owner = {
  id: userId,
  email: 'owner@gmail.com',
  displayName: 'Owner',
  role: 'super_admin',
  loginMethod: 'GOOGLE',
  isOwner: true,
  hasPassword: false,
};
const account = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'member@gmail.com',
  displayName: 'Member',
  role: 'editor',
  loginMethod: 'GOOGLE',
  hasPassword: false,
  isActive: true,
  isOwner: false,
  workspaceIds: [workspaceId],
  createdAt: '2026-10-06T00:00:00Z',
  lastLoginAt: null,
};
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
async function guest(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return json(route, {}, 401);
    if (path === '/api/auth/providers') return json(route, { google: true });
    return json(route, {}, 404);
  });
}
test('main login shows Google only and the password entry is unlinked and noindex', async ({
  page,
}) => {
  await guest(page);
  await page.goto('/fa/auth/login');
  await expect(page.getByRole('heading', { name: 'ورود به Docoo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ورود با گوگل' })).toHaveAttribute(
    'href',
    /\/api\/auth\/google\?redirectTo=/,
  );
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.locator('a[href*="login-up"]')).toHaveCount(0);
  const response = await page.goto('/fa/auth/login-up');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByLabel('ایمیل', { exact: true })).toBeVisible();
  await expect(page.getByLabel('گذرواژه', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ورود با گوگل' })).toBeVisible();
});
test('Google-only owner sees account administration and no password-change form', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === '/api/auth/session'
      ? json(route, { user: owner, workspaces: [workspace] })
      : json(route, { google: true });
  });
  await page.goto('/fa');
  await expect(page.getByRole('link', { name: 'کاربران', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ورود با جیمیل', exact: true })).toBeVisible();
  await expect(page.getByText('این حساب فقط با جیمیل وارد می‌شود و رمز عبور ندارد.')).toBeVisible();
  await expect(page.getByLabel('گذرواژهٔ فعلی')).toHaveCount(0);
});
test('owner creates a Google account without a password and assigns separate topic/project grants', async ({
  page,
}) => {
  let created: Record<string, unknown> | undefined;
  const grants: { kind: string; access: string | null }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === '/api/auth/session') return json(route, { user: owner, workspaces: [workspace] });
    if (path === '/api/owner/google-access' && request.method() === 'POST') {
      created = request.postDataJSON() as Record<string, unknown>;
      return json(route, account, 201);
    }
    if (path === '/api/owner/google-access')
      return json(route, {
        items: [account],
        total: 1,
        page: 1,
        totalPages: 1,
        workspaces: [workspace],
      });
    if (path.endsWith('/access'))
      return json(route, {
        topics: [
          {
            id: projectId,
            name: 'Private topic',
            isCreator: false,
            effective: null,
            granted: null,
          },
        ],
        projects: [
          {
            id: projectId,
            name: 'Private project',
            isCreator: true,
            effective: 'EDIT',
            granted: null,
          },
        ],
      });
    if (path.includes('/access/')) {
      grants.push({
        kind: path.includes('/topic/') ? 'topic' : 'project',
        access: (request.postDataJSON() as { access: string | null }).access,
      });
      return json(route, {});
    }
    return json(route, {}, 404);
  });
  await page.goto('/en/settings/google-access');
  await expect(page.getByText('member@gmail.com')).toBeVisible();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('new.member@gmail.com');
  await page.getByLabel('Name', { exact: true }).fill('New member');
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => created?.['email']).toBe('new.member@gmail.com');
  expect(created?.['loginMethod']).toBe('GOOGLE');
  expect(created).not.toHaveProperty('password');
  await page.getByRole('button', { name: 'Topic and project access' }).click();
  await page.getByLabel('Private topic', { exact: true }).selectOption('VIEW');
  await expect.poll(() => grants.length).toBe(1);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(
    page.getByLabel('Private project', { exact: true }).locator('option[value=NONE]'),
  ).toHaveCount(0);
  await page.getByLabel('Private project', { exact: true }).selectOption('VIEW');
  await expect.poll(() => grants.length).toBe(2);
  expect(grants).toEqual([
    { kind: 'topic', access: 'VIEW' },
    { kind: 'project', access: 'VIEW' },
  ]);
});
test('ordinary administrators cannot open the owner Gmail page', async ({ page }) => {
  await page.route('**/api/**', async (route) =>
    json(route, { user: { ...owner, isOwner: false }, workspaces: [workspace] }),
  );
  await page.goto('/fa/settings/google-access');
  await expect(page.locator('p[role=alert]')).toHaveText('اجازهٔ دسترسی به این بخش را ندارید.');
  await expect(page.getByRole('button', { name: 'افزودن حساب' })).toHaveCount(0);
});
test('VIEW preserves project content and hides editing and lifecycle controls', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session')
      return json(route, {
        user: { ...owner, role: 'viewer', isOwner: false },
        workspaces: [{ ...workspace, role: 'viewer' }],
      });
    if (path === '/api/auth/access') return json(route, { access: 'VIEW' });
    if (path.endsWith('/projects/' + projectId))
      return json(route, {
        project: {
          id: projectId,
          code: 'VIEW',
          title: 'Readable project',
          description: 'Description',
          initialProblem: 'Readable problem',
          outputLanguage: 'en',
          status: 'draft',
          currentStage: 'analysis',
          pauseReason: null,
          nextAction: 'complete_problem',
          availableCommands: ['activate', 'archive', 'delete', 'clone'],
          topics: [],
          business: null,
          approvedProblemVersionId: null,
          version: 1,
          deletedAt: null,
          purgeAfter: null,
          updatedAt: '2026-10-06T00:00:00Z',
        },
      });
    return json(route, {}, 404);
  });
  await page.goto('/en/projects/' + projectId);
  await expect(page.getByText('You have view-only access to this project.')).toBeVisible();
  await expect(page.getByText('Readable problem', { exact: true })).toBeVisible();
  await expect(page.locator('[data-write-action]:visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
});
test('viewers cannot open the project creation form directly', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    json(route, {
      user: { ...owner, role: 'viewer', isOwner: false },
      workspaces: [{ ...workspace, role: 'viewer' }],
    }),
  );
  await page.goto('/en/projects/new');
  await expect(page.locator('p[role=alert]')).toHaveText('Viewers cannot create projects.');
  await expect(page.locator('form')).toHaveCount(0);
});
