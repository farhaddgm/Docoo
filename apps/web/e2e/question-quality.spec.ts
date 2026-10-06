import { expect, test } from '@playwright/test';

import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { questionQualityMessages } from '../app/[locale]/projects/[projectId]/question-quality-messages';
import { settingsMessages } from '../app/[locale]/settings/settings-messages';
import {
  completeAnalysis,
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const detail = projectPageMessages('fa');
const quality = questionQualityMessages('fa');
const settings = settingsMessages('fa');
const stamp = Date.now().toString(36);

/**
 * The Brain judges the analyst's questions with the model (ADR-0024): the judgement names the
 * questions it rests on, the aspects judged are chosen in the settings, and the offline test
 * provider stands in for a real model.
 */
test.describe('question quality (QQ-001)', () => {
  test('evaluates the questions, shows findings with question numbers, and follows the chosen aspects', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);

    const area = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `qq-${stamp}`,
      title: `Question quality ${stamp}`,
    });
    const project = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `qq-${stamp}`,
      title: `Question quality project ${stamp}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId: area.topic.id }],
    });
    await page.goto(`/fa/projects/${project.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(page.locator('.facts .badge').first()).toHaveText(detail.statuses['active']!);
    await completeAnalysis(page);

    const section = page.getByRole('region', { name: quality.title });
    await expect(section).toBeVisible();
    await expect(section.getByText(quality.none)).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await section.getByRole('button', { name: quality.run }).click();
    await expect(page.getByRole('status').filter({ hasText: quality.done })).toBeVisible({
      timeout: 60_000,
    });
    await expect(section.getByText('امتیاز: ۴ از ۵')).toBeVisible();
    await expect(
      section.getByRole('heading', { level: 5, name: quality.weaknesses }),
    ).toBeVisible();
    await expect(section.getByRole('heading', { level: 5, name: quality.strengths })).toBeVisible();
    // Each finding names its criterion and the numbers of the questions it rests on.
    await expect(
      section.getByRole('list', { name: quality.weaknesses }).getByText(quality.criteria['vague']!),
    ).toBeVisible();
    await expect(
      section
        .getByRole('list', { name: quality.strengths })
        .getByText(`${quality.questions}: ۱`, { exact: false }),
    ).toBeVisible();
    for (const criterion of Object.values(quality.criteria)) {
      await expect(section.getByText(criterion).first()).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);

    // Only the chosen aspects are judged: pick "tone" alone in the settings and evaluate again.
    await page.goto('/fa/settings');
    const criteria = page
      .locator('ul.plain-list > li')
      .filter({ has: page.locator('code:text-is("analysis.quality_criteria")') });
    await expect(criteria.getByRole('checkbox')).toHaveCount(5);
    for (const key of ['decision_relevance', 'leading', 'duplicate', 'vague'] as const) {
      await criteria
        .getByRole('checkbox', { name: settings.enumLabels['analysis.quality_criteria']![key]! })
        .uncheck();
    }
    await criteria.getByLabel(settings.reasonLabel).fill('فقط لحن');
    await criteria.getByRole('button', { name: settings.save, exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'analysis.quality_criteria' }),
    ).toContainText('ذخیره شد');
    await expectNoSeriousA11yViolations(page);

    await page.goto(`/fa/projects/${project.project.id}`);
    await page.getByRole('button', { name: detail.tabs.problem, exact: true }).click();
    const again = page.getByRole('region', { name: quality.title });
    await again.getByRole('button', { name: quality.run }).click();
    await expect(page.getByRole('status').filter({ hasText: quality.done })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      again.getByText(`${quality.criteriaHeading}: ${quality.criteria['tone']}`),
    ).toBeVisible();
    await expect(again.getByText(quality.noFindings)).toBeVisible();
    // The earlier judgement stays as history.
    await again.getByText(quality.earlier).click();
    await expect(again.locator('details li')).toHaveCount(1);

    // Leave the workspace as it was.
    await page.goto('/fa/settings');
    await criteria.getByLabel(settings.reasonLabel).fill('بازگشت');
    await criteria.getByRole('button', { name: settings.resetWorkspace }).click();
    await expect(criteria.getByRole('checkbox', { checked: true })).toHaveCount(5);
  });
});
