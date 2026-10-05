import { expect, test } from '@playwright/test';

import { projectMessages } from '../app/[locale]/projects/messages';
import { createViaApi, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const text = projectMessages('fa');
const stamp = Date.now().toString(36);

test.describe('the project list filters and extra columns (UX §4)', () => {
  test('filter by topic, language and text; owner and language columns; clear', async ({
    page,
  }) => {
    await signInWithKeyboard(page);
    const topicA = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `pl-a-${stamp}`,
      title: `حوزهٔ الف ${stamp}`,
    });
    const topicB = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `pl-b-${stamp}`,
      title: `حوزهٔ ب ${stamp}`,
    });
    const make = (code: string, title: string, topicId: string, outputLanguage: 'fa' | 'en') =>
      createViaApi(page, '/projects', {
        code,
        title,
        initialProblem: 'مسئلهٔ آزمون پالایش فهرست',
        outputLanguage,
        topics: [{ topicId }],
      });
    await make(`plf-${stamp}`, 'پروژهٔ فارسی الف', topicA.topic.id, 'fa');
    await make(`ple-${stamp}`, 'پروژهٔ انگلیسی ب', topicB.topic.id, 'en');

    await page.goto('/fa/projects');
    const rows = page.getByRole('table').locator('tbody tr');
    const filters = page.getByRole('form', { name: text.filters });
    await expect(page.getByRole('rowheader', { name: `plf-${stamp}` })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: `ple-${stamp}` })).toBeVisible();
    // The owner is the administrator who created them; the language column shows the output language.
    await expect(rows.filter({ hasText: `plf-${stamp}` })).toContainText(text.languages.fa);
    await expect(rows.filter({ hasText: `ple-${stamp}` })).toContainText(text.languages.en);
    await expectNoSeriousA11yViolations(page);

    await filters.getByLabel(text.topicFilter).selectOption({ label: `حوزهٔ ب ${stamp}` });
    await expect(page.getByRole('rowheader', { name: `ple-${stamp}` })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: `plf-${stamp}` })).toHaveCount(0);

    await page.getByRole('button', { name: text.clearFilters }).click();
    await expect(page.getByRole('rowheader', { name: `plf-${stamp}` })).toBeVisible();

    await filters.getByLabel(text.languageFilter).selectOption('fa');
    await expect(page.getByRole('rowheader', { name: `plf-${stamp}` })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: `ple-${stamp}` })).toHaveCount(0);

    await page.getByRole('button', { name: text.clearFilters }).click();
    await filters.getByLabel(text.searchLabel).fill(`ple-${stamp}`);
    await expect(page.getByRole('rowheader', { name: `ple-${stamp}` })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: `plf-${stamp}` })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });
});
