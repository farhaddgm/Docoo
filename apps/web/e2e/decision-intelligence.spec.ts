import { expect, test } from '@playwright/test';
import { apiSession, createViaApi, signInWithKeyboard } from './support';

test('project intelligence searches bilingual evidence and previews missing coverage', async ({
  page,
}) => {
  await signInWithKeyboard(page);
  const { workspaceId, headers } = await apiSession(page);
  const { project } = await createViaApi<{ project: { id: string } }>(page, '/projects', {
    code: 'intelligence-' + Date.now(),
    title: 'Evidence decision',
    initialProblem: 'Customer retention',
    topics: [],
  });
  const { knowledge } = await createViaApi<{ knowledge: { id: string } }>(page, '/knowledge', {
    title: 'Retention evidence',
    content:
      'Customer churn decreased because support improved. The committee supplied the approved observation for this project.',
    language: 'en',
    sourceType: 'admin_provided',
    provenance: { declaration: 'Approved committee observation' },
    scopes: [{ type: 'project', id: project.id }],
  });
  const audit = await page.request.post(
    `/api/workspaces/${workspaceId}/knowledge/${knowledge.id}/submit-audit`,
    { headers },
  );
  expect(audit.ok(), await audit.text()).toBe(true);
  await page.goto(`/fa/projects/${project.id}`);
  await page.getByRole('link', { name: 'شواهد و تصمیم', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'شواهد و تصمیم پروژه' })).toBeVisible();
  const search = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'جست‌وجوی شواهد مجاز' }) });
  await search.getByLabel('پرسش یا عبارت').fill('ریزش مشتری');
  await search.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
  await search.locator('summary').filter({ hasText: 'Retention evidence' }).first().click();
  await expect(search.getByText(/Customer churn decreased/).first()).toBeVisible();
  const research = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'پژوهش تطبیقی', exact: true }) });
  await research
    .locator('textarea[name="questions"]')
    .fill('customer churn\nunobtainable actuarial liability');
  await research.getByRole('button', { name: 'پیش‌نمایش پوشش' }).click();
  await expect(research.getByText('شواهد ناکافی', { exact: true }).first()).toBeVisible();
  await page.goto(`/en/projects/${project.id}/intelligence`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Project evidence and decisions' }),
  ).toBeVisible();
});
