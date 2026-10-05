import { expect, test, type Page } from '@playwright/test';

import { agentMessages, fill } from '../app/[locale]/agents/agent-messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const text = agentMessages('fa');
const english = agentMessages('en');
const detail = projectPageMessages('fa');
const stamp = Date.now().toString(36);

/** Persian digits back to a number, as the pages show them. */
const num = (value: string) =>
  Number(
    value
      .replace(/[۰-۹]/gu, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[^0-9]/gu, ''),
  );
const digits = (value: number) => new Intl.NumberFormat('fa').format(value);
const versionLabel = (n: number) => fill(text.versionLabel, { n: digits(n) });

/**
 * Agents (AGT-001..005) in the browser: the six roles, an edit with a diff preview, a version
 * that waits for activation, rollback, the tool allowlist, a role's own model, and a project's
 * independent copy. One sign-in keeps clear of the login rate limit.
 */
test.describe('agents in Persian and English (AGT-001..005)', () => {
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

  test('lists the six roles from the navigation and stays accessible', async () => {
    await page.goto('/fa');
    await page
      .getByRole('navigation', { name: 'ناوبری اصلی' })
      .getByRole('link', { name: 'ایجنت‌ها' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(6);
    for (const role of [
      'analyst',
      'researcher',
      'ideator',
      'documenter',
      'evaluator',
      'brain',
    ] as const) {
      await expect(rows.filter({ hasText: text.roles[role].name })).toHaveCount(1);
    }
    await expect(rows.filter({ hasText: text.sideRole })).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
  });

  test('edits a principle with a diff preview, saves a version that waits, activates it and goes back', async () => {
    await page.goto('/fa/agents');
    await page
      .getByRole('link', { name: fill(text.openLabel, { role: text.roles.researcher.name }) })
      .click();
    await expect(
      page.getByRole('heading', { level: 2, name: text.roles.researcher.name }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // The version the role runs with now.
    const headerBadge = page.locator('.badge.state-passed').first();
    await expect(headerBadge).toContainText(text.active);
    const before = num(await headerBadge.innerText());

    const principles = page.getByRole('group', { name: text.sections.principles });
    const marker = `اصل آزمون ${stamp}`;
    await principles.getByRole('button', { name: text.addPrinciple }).click();
    await principles.getByRole('textbox').last().fill(marker);
    // The preview shows exactly what changes, in words as well as colour.
    const added = page.locator('.diff-added').filter({ hasText: marker });
    await expect(added).toBeVisible();
    await expect(added.getByText(text.added, { exact: false })).toHaveCount(1);

    // A reason is required.
    await page.getByRole('button', { name: text.save, exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: text.clientIssues.needReason }),
    ).toBeVisible();

    await page.getByLabel(text.reasonLabel, { exact: true }).fill('اصل تازه برای تحقیق');
    await page.getByRole('button', { name: text.save, exact: true }).click();
    const savedNotice = page.getByRole('status').filter({ hasText: 'هنوز فعال نیست' });
    await expect(savedNotice).toBeVisible();
    const after = num((await savedNotice.innerText()).match(/[۰-۹]+/u)![0]);
    expect(after).toBeGreaterThan(before);

    // Saved, not active: the header still shows the old version and the history lists both.
    await expect(headerBadge).toContainText(versionLabel(before));
    const history = page.getByRole('region', { name: text.historyHeading });
    await expect(
      history.locator('.version-row').filter({ hasText: versionLabel(after) }),
    ).toBeVisible();
    await expect(history.locator('.version-row .badge.state-passed')).toHaveCount(1);

    // Activate it with a reason.
    await page.getByLabel(text.activateReason).first().fill('فعال‌سازی نسخهٔ تازه');
    await page.getByRole('button', { name: fill(text.activateNow, { n: digits(after) }) }).click();
    await expect(headerBadge).toContainText(versionLabel(after));
    await expect(
      history
        .locator('.version-row')
        .filter({ hasText: versionLabel(after) })
        .locator('.badge.state-passed'),
    ).toBeVisible();

    // Roll back: activating the earlier version, which stays in the history unchanged.
    await history.getByLabel(text.activateReason).fill('بازگشت به نسخهٔ قبلی');
    await history
      .getByRole('button', { name: `${text.restore}: ${versionLabel(before)}`, exact: true })
      .click();
    await expect(headerBadge).toContainText(versionLabel(before));
    await expect(
      history.locator('.version-row').filter({ hasText: versionLabel(after) }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('offers only the tools inside the role ceiling and previews a change of tools', async () => {
    await page.goto('/fa/agents/researcher');
    const tools = page.getByRole('group', { name: text.sections.tools });
    await expect(tools.getByRole('checkbox')).toHaveCount(6);
    await expect(tools.getByLabel(text.tools.web_search.label)).toBeChecked();
    // A tool outside the researcher's ceiling is not even offered.
    await expect(tools.getByText(text.tools.document_renderer.label)).toHaveCount(0);

    await tools.getByLabel(text.tools.web_read.label).uncheck();
    const preview = page.getByRole('region', { name: text.preview });
    await expect(preview.getByRole('heading', { name: text.sections.tools })).toBeVisible();
    await expect(
      preview.locator('.diff-removed').filter({ hasText: text.tools.web_read.label }),
    ).toBeVisible();
    await page.getByRole('button', { name: text.reset }).click();
    await expect(tools.getByLabel(text.tools.web_read.label)).toBeChecked();
    await expect(preview.getByText(text.noChanges)).toBeVisible();
  });

  test('a role can name its own model from a connection, with its capabilities checked', async () => {
    await useFakeProvider(page);
    await page.goto('/fa/agents/documenter');
    await expect(
      page.getByRole('heading', { level: 2, name: text.roles.documenter.name }),
    ).toBeVisible();
    const model = page.getByRole('group', { name: text.modelHeading });
    await model.getByRole('radio', { name: text.useOwnModel }).check();
    await model
      .getByRole('combobox', { name: text.connection, exact: true })
      .selectOption({ index: 1 });
    await expect(
      model.getByRole('combobox', { name: text.model, exact: true }).locator('option'),
    ).not.toHaveCount(1);
    await model
      .getByRole('combobox', { name: text.model, exact: true })
      .selectOption('fake-standard');
    const preview = page.getByRole('region', { name: text.preview });
    await expect(preview.locator('.diff-added').filter({ hasText: 'fake-standard' })).toBeVisible();

    await page.getByLabel(text.reasonLabel, { exact: true }).fill('مدل اختصاصی مستندساز');
    await page.getByRole('button', { name: text.save, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'هنوز فعال نیست' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('works in English too: left to right, every section named, accessible', async () => {
    await page.goto('/en/agents');
    await expect(page.getByRole('heading', { level: 1, name: english.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await expectNoSeriousA11yViolations(page);
    await page
      .getByRole('link', { name: fill(english.openLabel, { role: english.roles.analyst.name }) })
      .click();
    await expect(
      page.getByRole('heading', { level: 2, name: english.roles.analyst.name }),
    ).toBeVisible();
    for (const section of ['principles', 'duties', 'tools'] as const) {
      await expect(page.getByRole('group', { name: english.sections[section] })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: english.modelHeading })).toBeVisible();
    await expect(page.getByRole('heading', { name: english.historyHeading })).toBeVisible();
    await expect(page.getByRole('heading', { name: english.outputsHeading })).toBeVisible();
    await expect(page.getByRole('heading', { name: english.performanceHeading })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('a project copies a role, edits only its copy and moves back to the default', async () => {
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `agt-${stamp}`,
      title: `حوزهٔ ایجنت ${stamp}`,
    });
    const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `agt-${stamp}`,
      title: `پروژهٔ ایجنت ${stamp}`,
      initialProblem: 'کاهش ریزش مشتریان تکراری تا ۲۰ درصد.',
      topics: [{ topicId: topic.topic.id }],
    });
    await page.goto(`/fa/projects/${created.project.id}`);
    await page.getByRole('button', { name: detail.tabs.agents, exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: text.projectHeading })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    const rows = page.locator('li.agent-row');
    await expect(rows).toHaveCount(6);
    const row = rows.filter({
      has: page.getByRole('heading', { name: text.roles.researcher.name }),
    });
    // Nothing is pinned before a run starts; the default shows through.
    await expect(row.locator('.badge').first()).toContainText('هنوز سنجاق نشده');
    await expect(row.getByRole('button', { name: new RegExp(text.editCopy) })).toHaveCount(0);

    await row
      .getByRole('button', { name: `${text.copyDefault}: ${text.roles.researcher.name}` })
      .click();
    await expect(row.getByText(text.copyWarning)).toBeVisible();
    await row.getByLabel(text.copyReason).fill('این پروژه تحقیق‌کنندهٔ مخصوص می‌خواهد');
    await row.getByRole('button', { name: text.copyConfirm }).click();
    await expect(page.getByRole('status').filter({ hasText: text.copied })).toBeVisible();
    await expect(row.locator('.badge').first()).toContainText('کپی اختصاصی پروژه');

    // The editor of the copy opens; an edit saves a new version of the copy only.
    const duties = row.getByRole('group', { name: text.sections.duties });
    await duties.getByRole('button', { name: text.addDuty }).click();
    await duties.getByRole('textbox').last().fill(`وظیفهٔ این پروژه ${stamp}`);
    await row.getByLabel(text.reasonLabel, { exact: true }).fill('وظیفهٔ اختصاصی');
    await row.getByRole('button', { name: text.saveProject }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'برای همین پروژه فعال شد' }),
    ).toBeVisible();
    await expect(row.locator('.badge').first()).toContainText(digits(2));

    // The copy differs from the default, and the comparison says how.
    await row.getByText(text.compare).click();
    await expect(
      row.locator('.diff-added').filter({ hasText: `وظیفهٔ این پروژه ${stamp}` }),
    ).toBeVisible();

    // Back to the default is a decision with a reason; the copy stays in the history.
    await row
      .getByRole('button', { name: `${text.useDefault}: ${text.roles.researcher.name}` })
      .click();
    await row.getByLabel(text.pinReason, { exact: true }).fill('برگشت به پیش‌فرض');
    await row.getByRole('button', { name: text.pinConfirm }).click();
    await expect(page.getByRole('status').filter({ hasText: text.pinned })).toBeVisible();
    await expect(row.locator('.badge').first()).not.toContainText('کپی اختصاصی');
    await expect(row.getByRole('button', { name: new RegExp(text.copyDefault) })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
