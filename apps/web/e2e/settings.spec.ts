import { expect, test, type Locator, type Page } from '@playwright/test';

import { projectMessages } from '../app/[locale]/projects/messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { solutionMessages } from '../app/[locale]/projects/[projectId]/solution-messages';
import { wizardMessages } from '../app/[locale]/projects/new/wizard-messages';
import { settingsMessages } from '../app/[locale]/settings/settings-messages';
import { templatesMessages } from '../app/[locale]/templates/templates-messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const settings = settingsMessages('fa');
const templates = templatesMessages('fa');
const wizard = wizardMessages('fa');
const project = projectMessages('fa');
const detail = projectPageMessages('fa');
const solutionText = solutionMessages('fa');
const stamp = Date.now().toString(36);
const problem = (scope: Page | Locator) => scope.locator('.notice.error[role="alert"]');
const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'ناوبری اصلی' });

/** The row of one setting on the settings page (its key is shown next to the description). */
const row = (page: Page, key: string): Locator =>
  page.locator('ul.plain-list > li').filter({ has: page.locator(`code:text-is("${key}")`) });

async function saveSetting(page: Page, key: string, value: string, reason: string) {
  const item = row(page, key);
  await item.getByRole('spinbutton').fill(value);
  await item.getByLabel(settings.reasonLabel).fill(reason);
  await item.getByRole('button', { name: settings.save, exact: true }).click();
}

/**
 * System settings, templates and levels, and the project wizard in the browser (ADR-0018):
 * every change needs a reason and keeps its history, the wizard shows where each effective
 * value comes from, and a project saves its own values together with itself.
 */
test.describe('settings, templates and the project wizard (STP-001..006)', () => {
  test('system settings: change with a reason, history, restore and reset', async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);

    await mainNavigation(page).getByRole('link', { name: 'تنظیمات سامانه' }).click();
    await expect(page).toHaveURL(/\/fa\/settings$/u);
    await expect(page.getByRole('heading', { level: 1, name: settings.title })).toBeVisible();
    for (const group of Object.values(settings.groups)) {
      await expect(page.getByRole('heading', { level: 2, name: group.title })).toBeVisible();
    }
    // Honest about what has no effect yet, and where the model is chosen.
    // Both settings that used to be recorded only are applied now, so no row carries the note.
    await expect(page.getByText(settings.notEnforced)).toHaveCount(0);
    await expect(
      row(page, 'ai.model').getByRole('link', { name: settings.openProviders }),
    ).toHaveAttribute('href', '/fa/providers');
    await expectNoSeriousA11yViolations(page);

    // A change needs a reason and a value that passes the range.
    const count = row(page, 'solution.count');
    await count.getByRole('spinbutton').fill('7');
    await expect(count.getByRole('button', { name: settings.save, exact: true })).toBeDisabled();
    await count.getByRole('spinbutton').fill('99');
    await count.getByLabel(settings.reasonLabel).fill('خیلی زیاد');
    await expect(problem(count)).toContainText('بیشتر از ۲۰');
    await expect(count.getByRole('button', { name: settings.save, exact: true })).toBeDisabled();

    await saveSetting(page, 'solution.count', '7', 'برای آزمون');
    await expect(page.getByRole('status').filter({ hasText: 'solution.count' })).toContainText(
      'ذخیره شد',
    );
    await expect(count.getByText(settings.sources.workspace, { exact: true })).toBeVisible();
    await expect(count.getByRole('spinbutton')).toHaveValue('7');

    // A second version, then the history restores the first as a new version.
    await saveSetting(page, 'solution.count', '8', 'دوباره');
    await expect(count.getByRole('spinbutton')).toHaveValue('8');
    await count.getByRole('button', { name: settings.history }).click();
    // Earlier runs may have left versions; this run's two are the newest.
    const versions = count.locator('.version-row');
    await expect(versions.first()).toBeVisible();
    const before = await versions.count();
    expect(before).toBeGreaterThanOrEqual(2);
    await count.getByLabel(settings.reasonLabel).fill('برگشت');
    await versions
      .filter({ hasText: 'برای آزمون' })
      .first()
      .getByRole('button', { name: settings.restore })
      .click();
    await expect(count.getByRole('spinbutton')).toHaveValue('7');
    await expect(versions).toHaveCount(before + 1);
    await expect(versions.first()).toContainText(settings.historyRestored.replace('{n}', ''));

    // Back to the system default clears the workspace value.
    await count.getByLabel(settings.reasonLabel).fill('بازگشت');
    await count.getByRole('button', { name: settings.resetWorkspace }).click();
    await expect(count.getByRole('spinbutton')).toHaveValue('5');
    await expect(count.getByText(settings.sources.system, { exact: true }).first()).toBeVisible();

    // A boolean and a list setting.
    const approval = row(page, 'workflow.require_human_approval');
    await expect(approval.getByRole('checkbox')).toBeChecked();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/settings$/u);
    await expect(
      page.getByRole('heading', { level: 1, name: settingsMessages('en').title }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('templates and levels: ranges are checked, saved with a reason and the default template changes', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    await mainNavigation(page).getByRole('link', { name: 'قالب‌ها و سطوح سند' }).click();
    await expect(page).toHaveURL(/\/fa\/templates$/u);
    await expect(page.getByRole('heading', { level: 1, name: templates.title })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: templates.levelsTitle }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    const levelMin = (n: number) =>
      page.getByLabel(`${templates.level.replace('{n}', n === 1 ? '۱' : '۲')}: ${templates.min}`);
    const levelMax = (n: number) =>
      page.getByLabel(`${templates.level.replace('{n}', n === 1 ? '۱' : '۲')}: ${templates.max}`);
    const save = page.getByRole('button', { name: templates.saveLevels });
    const reason = page.getByLabel(templates.reasonLabel).first();

    // A range that breaks the rules is explained and cannot be saved.
    await levelMin(1).fill('999999999');
    await reason.fill('آزمون');
    await expect(problem(page)).toContainText(
      templates.boundsProblems['min_not_below_max']!.replace('{level}', '۱'),
    );
    await expect(save).toBeDisabled();
    await levelMin(1).fill('1500');
    await levelMax(1).fill('3500');
    await expect(problem(page)).toHaveCount(0);
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: templates.savedLevels })).toBeVisible();

    await page.reload();
    await expect(levelMin(1)).toHaveValue('1500');
    await expect(levelMax(1)).toHaveValue('3500');
    // The system default is one click away.
    await page.getByRole('button', { name: templates.restoreDefaults }).click();
    await expect(levelMin(1)).toHaveValue('1000');
    await page.getByLabel(templates.reasonLabel).first().fill('بازگشت به پیش‌فرض');
    await page.getByRole('button', { name: templates.saveLevels }).click();
    await expect(page.getByRole('status').filter({ hasText: templates.savedLevels })).toBeVisible();

    // Templates: three, each with its sections; choosing one needs a reason.
    const group = page.getByRole('group', { name: templates.defaultTemplate });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(
      group.getByText('خلاصه ← فرض‌ها ← شواهد ← برنامهٔ اجرا ← ریسک‌ها', { exact: true }),
    ).toBeVisible();
    await group.getByRole('radio', { name: new RegExp(templates.names['detailed']!, 'u') }).check();
    await expect(page.getByRole('button', { name: templates.saveTemplate })).toBeDisabled();
    await page.getByLabel(templates.reasonLabel).last().fill('اسناد تفصیلی');
    await page.getByRole('button', { name: templates.saveTemplate }).click();
    await expect(
      page.getByRole('status').filter({ hasText: templates.savedTemplate }),
    ).toBeVisible();
    await expect(group.getByText(templates.isDefault, { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Put the default back so later tests start from the same place.
    await group.getByRole('radio', { name: new RegExp(templates.names['standard']!, 'u') }).check();
    await page.getByLabel(templates.reasonLabel).last().fill('بازگشت');
    await page.getByRole('button', { name: templates.saveTemplate }).click();
    await expect(
      page.getByRole('status').filter({ hasText: templates.savedTemplate }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: templatesMessages('en').title }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('wizard: eight steps, a draft that survives a reload, the effective configuration and a project that keeps its own values', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `wz-${stamp}`,
      title: `حوزهٔ ویزارد ${stamp}`,
    });

    await page.goto('/fa/projects/new');
    const next = page.getByRole('button', { name: wizard.next });
    await expect(page.getByRole('navigation', { name: wizard.stepsLabel })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(wizard.steps[0]!, 'u') }),
    ).toBeVisible();

    // Step 1 asks for the basics before it lets you go on.
    await expect(next).toBeDisabled();
    await expect(problem(page)).toContainText(wizard.needBasics);
    await page.locator('#project-code').fill(`wz-${stamp}`);
    await page.locator('#project-title').fill(`پروژهٔ ویزارد ${stamp}`);
    await page.locator('#project-problem').fill('کاهش ریزش مشتریان برنامهٔ وفاداری');
    await expect(next).toBeEnabled();

    // The draft is kept: a reload brings the same step and values back.
    await page.reload();
    await expect(page.getByText(wizard.draftRestored)).toBeVisible();
    await expect(page.locator('#project-title')).toHaveValue(`پروژهٔ ویزارد ${stamp}`);
    await next.click();

    // Step 2: topics.
    await page.locator('#project-add-topic').selectOption(topic.topic.id);
    await page.getByRole('button', { name: project.addTopic }).click();
    await expectNoSeriousA11yViolations(page);
    await next.click();

    // Step 3: workflow and gates; only a changed value becomes the project's own.
    const attempts = page.getByRole('spinbutton').first();
    await expect(page.getByText(wizard.inherited).first()).toBeVisible();
    await page.getByRole('checkbox').uncheck();
    await expect(page.getByText(wizard.changedHere)).toBeVisible();
    await attempts.fill('0');
    await expect(problem(page).first()).toContainText('کمتر از ۱');
    await expect(next).toBeDisabled();
    await attempts.fill('4');
    await expectNoSeriousA11yViolations(page);
    await next.click();

    // Step 4: model; left to the workspace default.
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(wizard.steps[3]!, 'u') }),
    ).toBeVisible();
    await next.click();
    // Step 5: knowledge.
    await page.getByRole('spinbutton').first().fill('3');
    await next.click();
    // Step 6: solutions, and their criteria; the enabled weights must add up to 100.
    await page.getByRole('spinbutton').first().fill('6');
    const criteria = page.getByRole('region', { name: wizard.criteriaTitle });
    await expect(criteria).toBeVisible();
    await expect(next).toBeEnabled(); // the defaults are valid and nothing is sent for them
    await criteria
      .getByRole('checkbox', { name: new RegExp(`^${wizard.enabled}: Time`, 'u') })
      .uncheck();
    await expect(problem(page).last()).toContainText('۹۰');
    await expect(next).toBeDisabled();
    await criteria
      .getByRole('spinbutton', { name: new RegExp(`^${wizard.weight}: Impact`, 'u') })
      .fill('35');
    await expect(next).toBeEnabled();
    await expectNoSeriousA11yViolations(page);
    await next.click();
    // Step 7: documents.
    await page.getByRole('spinbutton').first().fill('4');
    await page.getByRole('combobox').first().selectOption('brief');
    await page.getByRole('combobox').nth(1).selectOption('pdf');
    await expectNoSeriousA11yViolations(page);
    await next.click();

    // Step 8: the effective configuration with the source of every value.
    const review = page.getByRole('region', { name: wizard.reviewTable });
    await expect(review).toBeVisible();
    const reviewRow = (key: string) =>
      review.locator('tr').filter({ has: page.locator(`code:text-is("${key}")`) });
    for (const key of [
      'solution.count',
      'workflow.max_attempts_per_stage',
      'document.default_template',
      'document.default_export_format',
      'document.level',
      'research.max_queries',
      'workflow.require_human_approval',
    ]) {
      await expect(
        reviewRow(key).getByText(settings.sources.pending, { exact: true }),
      ).toBeVisible();
    }
    await expect(reviewRow('solution.count')).toContainText('۶');
    await expect(reviewRow('document.default_template')).toContainText(
      settings.enumLabels['document.default_template']!['brief']!,
    );
    // Untouched values say they are inherited.
    await expect(
      reviewRow('ai.max_cost_usd_per_run').getByText(settings.sources.system, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(wizard.overridesCount.replace('{n}', '۷'))).toBeVisible();
    await expect(page.getByText(wizard.criteriaCustom.replace('{n}', '۵'))).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(wizard.steps[7]!, 'u') }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: wizard.create }).click();

    // The project exists with its own values; the Settings tab shows them as its own.
    await expect(page).toHaveURL(/\/fa\/projects\/[0-9a-f-]{36}$/u);
    await page.getByRole('button', { name: detail.tabs.settings, exact: true }).click();
    const own = row(page, 'solution.count');
    await expect(own.getByRole('spinbutton')).toHaveValue('6');
    await expect(own.getByText(settings.sources.project, { exact: true })).toBeVisible();
    await expect(row(page, 'document.level').getByRole('spinbutton')).toHaveValue('4');
    await expect(
      row(page, 'ai.max_cost_usd_per_run')
        .getByText(settings.sources.system, { exact: true })
        .first(),
    ).toBeVisible();
    // The criteria chosen in the wizard are version 1 of the project's criteria.
    await page.getByRole('button', { name: detail.tabs.solutions, exact: true }).click();
    await expect(page.getByText(solutionText.criteriaVersion.replace('{n}', '۱'))).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: /Impact/u })).toHaveValue('35');
    await page.getByRole('button', { name: detail.tabs.settings, exact: true }).click();
    // Going back to the inherited value is one click with a reason.
    await own.getByLabel(settings.reasonLabel).fill('برگشت');
    await own.getByRole('button', { name: settings.resetProject }).click();
    await expect(own.getByRole('spinbutton')).toHaveValue('5');
    await expectNoSeriousA11yViolations(page);

    // The draft is gone once the project exists.
    await page.goto('/fa/projects/new');
    await expect(page.getByText(wizard.draftRestored)).toHaveCount(0);
    await expect(page.locator('#project-title')).toHaveValue('');
  });
});
