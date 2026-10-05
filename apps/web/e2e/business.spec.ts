import { expect, test, type Page } from '@playwright/test';

import { integrationMessages } from '../app/[locale]/integrations/messages';
import { businessMessages } from '../app/[locale]/projects/business-messages';
import { fill } from '../app/[locale]/agents/agent-messages';
import { wizardMessages } from '../app/[locale]/projects/new/wizard-messages';
import { apiSession, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const integ = integrationMessages('fa');
const biz = businessMessages('fa');
const bizEn = businessMessages('en');
const wizard = wizardMessages('fa');
const stamp = Date.now().toString(36);

const contenter = `http://127.0.0.1:${process.env['E2E_CONTENTER_PORT'] ?? '4010'}`;
const TOKEN = 'e2e-contenter-service-token-0123456789abcdef';
const WRONG_TOKEN = 'wrong-token-'.padEnd(40, 'x');
const FIRST = 'شعبهٔ دیجیتال وی‌پاد';
const SECOND = 'کافهٔ آزمون';

const digits = (value: number) => new Intl.NumberFormat('fa').format(value);

/** The stand-in for Contenter is edited and switched off through its control routes. */
async function control(path: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${contenter}/__control/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok, await response.text()).toBe(true);
}

/**
 * The business module (ADR-0021) in the browser: the connection to Contenter with a write-only
 * token, a business chosen in the wizard, the read-only view of everything Contenter holds, what
 * each agent role is given, a sync that creates a version, an outage that keeps the saved version,
 * and the change and removal of the link. One sign-in keeps clear of the login rate limit.
 */
test.describe('business from Contenter (BIZ-001..006)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);
  let page: Page;
  let projectUrl = '';

  test.beforeAll(async ({ browser }) => {
    await control('reset');
    const baseURL = test.info().project.use.baseURL;
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    page = await context.newPage();
    await signInWithKeyboard(page);
    // A clean start whatever an earlier run left behind (404 when nothing is connected).
    const { workspaceId, headers } = await apiSession(page);
    await page.request.delete(`/api/workspaces/${workspaceId}/integrations/contenter`, {
      headers,
    });
  });

  test.afterAll(async () => {
    await control('mode', { mode: 'up' });
    await page.context().close();
  });

  test('the connection page keeps the token write-only and shows the health of the connection', async () => {
    await page.goto('/fa');
    await page
      .getByRole('navigation', { name: 'ناوبری اصلی' })
      .getByRole('link', { name: 'اتصال‌ها' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: integ.title })).toBeVisible();
    await expect(page.getByText(integ.notConfigured)).toBeVisible();

    await page.getByLabel(integ.apiUrl, { exact: true }).fill(`${contenter}/api`);
    await page.getByLabel(integ.token, { exact: true }).fill(WRONG_TOKEN);
    await page.getByRole('button', { name: integ.save }).click();
    // Saving tries the connection at once; a token Contenter refuses is told plainly.
    const status = page.getByTestId('contenter-status');
    await expect(status).toContainText(integ.statuses['invalid']!);
    await expect(page.getByText(integ.lastErrors['unauthorized']!)).toBeVisible();

    await page.getByLabel(integ.token, { exact: true }).fill(TOKEN);
    await page.getByRole('button', { name: integ.save }).click();
    await expect(status).toContainText(integ.statuses['healthy']!);
    await expect(page.getByRole('status').filter({ hasText: integ.saved })).toBeVisible();
    // The token is never shown again: not in the field, not on the page.
    await expect(page.getByLabel(integ.token, { exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain(TOKEN);
    await expect(status.locator('code')).not.toHaveText('—');
    await expectNoSeriousA11yViolations(page);

    // An outage is shown as such, and the next check brings the state back.
    await control('mode', { mode: 'down' });
    await page.getByRole('button', { name: integ.test, exact: true }).click();
    await expect(status).toContainText(integ.statuses['unreachable']!);
    await control('mode', { mode: 'up' });
    await page.getByRole('button', { name: integ.test, exact: true }).click();
    await expect(status).toContainText(integ.statuses['healthy']!);
  });

  test('the wizard chooses a business; the project keeps its link', async () => {
    await page.goto('/fa/projects/new');
    await page.locator('#project-code').fill(`biz-${stamp}`);
    await page.locator('#project-title').fill(`پروژهٔ کسب‌وکار ${stamp}`);
    await page.locator('#project-problem').fill('افزایش درخواست وام دیجیتال');

    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(2);
    // A search narrows the list; Enter searches without sending the wizard form.
    const search = page.getByLabel(biz.picker.search);
    await search.fill('کافه');
    await search.press('Enter');
    await expect(radios).toHaveCount(1);
    await expect(radios.first()).toHaveAccessibleName(new RegExp(SECOND, 'u'));
    await search.fill('');
    await search.press('Enter');
    await expect(radios).toHaveCount(2);

    await page.getByRole('radio', { name: new RegExp(FIRST, 'u') }).check();
    await expect(page.getByTestId('business-selected')).toContainText(FIRST);
    await expectNoSeriousA11yViolations(page);

    // The choice survives a reload (the wizard keeps a draft) and shows in the review.
    await page.reload();
    await expect(page.getByTestId('business-selected')).toContainText(FIRST);
    const next = page.getByRole('button', { name: wizard.next });
    for (let step = 0; step < 7; step += 1) await next.click();
    await expect(page.locator('dl.facts').getByText(FIRST)).toBeVisible();
    await page.getByRole('button', { name: wizard.create }).click();

    await expect(page).toHaveURL(/\/fa\/projects\/[0-9a-f-]{36}$/u);
    projectUrl = page.url();
    // The header names the business and leads to its tab.
    await page.getByRole('button', { name: FIRST }).click();
    await expect(page.getByTestId('business-header')).toContainText(FIRST);
  });

  test('the Business tab shows everything Contenter holds, read-only', async () => {
    await page.goto(`${projectUrl}?tab=business`);
    const header = page.getByTestId('business-header');
    await expect(header).toContainText(FIRST);
    await expect(page.getByTestId('business-version')).toHaveText(digits(1));
    await expect(header.getByText(biz.panel.readOnlyNote)).toBeVisible();

    // Profile: grouped sections, who wrote them, empty ones listed.
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(
      'شعبهٔ دیجیتال یک بانک',
    );
    await expect(page.getByTestId('business-group-AUDIENCE')).toContainText('کارمندان حقوق‌بگیر');
    await expect(page.getByTestId('business-section-PERSONAS')).toContainText(biz.profile.aiDraft);
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(biz.profile.admin);
    await expect(page.getByRole('heading', { name: biz.profile.emptySections })).toBeVisible();
    await expect(page.getByRole('list', { name: biz.profile.emptySections })).toContainText(
      biz.profile.sections['CALENDAR']!,
    );
    await expect(page.getByRole('heading', { name: biz.profile.topics })).toBeVisible();
    await expect(page.getByText('وام دیجیتال', { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    const view = (name: string) =>
      page.getByRole('button', { name: biz.panel.viewNames[name]!, exact: true });

    // Facts and terminology: trust state, expiry, rules.
    await view('knowledge').click();
    const facts = page.getByTestId('business-facts');
    await expect(facts).toContainText('۵۰۰ میلیون تومان');
    const stale = facts.locator('tr', { hasText: 'نرخ کمپین قدیمی' });
    await expect(stale).toContainText(biz.knowledge.expired);
    await expect(stale).toContainText(biz.knowledge.unverified);
    await expect(facts.locator('tr', { hasText: 'سقف وام' })).toContainText(biz.knowledge.verified);
    const terms = page.getByTestId('business-terms');
    await expect(terms.locator('tr', { hasText: 'وی‌پاد بانک' })).toContainText(
      biz.knowledge.kinds['AVOID']!,
    );
    await expect(page.getByTestId('business-notes')).toContainText(
      'مشتریان را همیشه رسمی خطاب کن.',
    );
    await expectNoSeriousA11yViolations(page);

    // References and brand assets with their analysis.
    await view('sources').click();
    await expect(page.getByTestId('business-references')).toContainText('دربارهٔ وی‌پاد');
    await expect(page.getByTestId('business-assets')).toContainText('بنر کمپین بهار');
    await expect(page.getByTestId('business-assets')).toContainText('شاد و روشن');
    await expectNoSeriousA11yViolations(page);

    // Quality: Contenter's health score, the audit and the gaps.
    await view('quality').click();
    await expect(page.getByTestId('business-health-score')).toContainText(digits(62));
    await expect(page.getByTestId('business-audit-issues')).toContainText('رقبا نوشته نشده‌اند');
    await expect(page.getByText('جدول کارمزدها تأیید نشده است')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Nothing here can be edited: the tab has no field for the profile.
    await expect(page.locator('main textarea')).toHaveCount(0);
  });

  test('what each agent role sees is shown, with the exact data on request', async () => {
    await page.goto(`${projectUrl}?tab=business`);
    await page.getByRole('button', { name: biz.panel.viewNames['ai']!, exact: true }).click();
    const roles = page.getByTestId('business-roles');
    await expect(roles.locator('tbody tr')).toHaveCount(6);
    // The Brain only reviews outputs and gets no profile.
    await expect(page.getByTestId('business-role-brain')).toContainText(biz.ai.noneReason);

    // The analyst reads the situation sections, not the brand voice.
    await page
      .getByTestId('business-role-analyst')
      .getByRole('button', { name: biz.ai.show })
      .click();
    const detailBox = page.getByTestId('business-role-detail');
    await expect(detailBox).toContainText('شعبهٔ دیجیتال یک بانک');
    await expect(detailBox).not.toContainText('گرم، روشن و محترمانه');
    await expect(detailBox).toContainText(biz.ai.rules);
    await expectNoSeriousA11yViolations(page);

    // The writer reads the brand voice and the terminology.
    await page
      .getByTestId('business-role-documenter')
      .getByRole('button', { name: biz.ai.show })
      .click();
    await expect(detailBox).toContainText('گرم، روشن و محترمانه');
    await expect(detailBox).toContainText('وی‌پاد بانک');
    await expect(page.getByText(biz.ai.privacy)).toBeVisible();
  });

  test('a change in Contenter becomes a new version on sync; old versions stay readable', async () => {
    await page.goto(`${projectUrl}?tab=business`);
    await control('section', {
      id: 'biz-e2e-1',
      key: 'OVERVIEW',
      content: 'متن تازهٔ معرفی پس از ویرایش',
    });
    await page.getByRole('button', { name: biz.panel.sync }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: fill(biz.panel.syncedChanged, { version: digits(2) }) }),
    ).toBeVisible();
    await expect(page.getByTestId('business-version')).toHaveText(digits(2));
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(
      'متن تازهٔ معرفی پس از ویرایش',
    );

    // Syncing again finds nothing new.
    await page.getByRole('button', { name: biz.panel.sync }).click();
    await expect(page.getByRole('status').filter({ hasText: biz.panel.syncedSame })).toBeVisible();
    await expect(page.getByTestId('business-version')).toHaveText(digits(2));

    await page.getByRole('button', { name: biz.panel.viewNames['versions']!, exact: true }).click();
    const versions = page.getByTestId('business-versions');
    await expect(versions.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('business-version-2')).toContainText(biz.versions.current);
    await expect(page.getByTestId('business-version-2')).toContainText(
      biz.profile.sections['OVERVIEW']!,
    );
    await expect(page.getByTestId('business-version-1')).toContainText(biz.versions.first);
    await expectNoSeriousA11yViolations(page);

    // The first version is shown as it was, and one click brings the current one back.
    await page
      .getByTestId('business-version-1')
      .getByRole('button', { name: biz.versions.show })
      .click();
    await expect(page.getByTestId('business-old-version')).toContainText(digits(1));
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(
      'شعبهٔ دیجیتال یک بانک',
    );
    await page.getByRole('button', { name: biz.versions.back }).click();
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(
      'متن تازهٔ معرفی پس از ویرایش',
    );
  });

  test('while Contenter is down the saved version keeps working and the reason shows', async () => {
    await page.goto(`${projectUrl}?tab=business`);
    await control('mode', { mode: 'down' });
    await page.getByRole('button', { name: biz.panel.sync }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    // The page still shows the saved version, and says the last sync failed.
    await expect(page.getByTestId('business-version')).toHaveText(digits(2));
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText(
      'متن تازهٔ معرفی پس از ویرایش',
    );
    await expect(
      page.getByText(biz.panel.syncProblem.split('{reason}')[0]!, { exact: false }),
    ).toBeVisible();
    await control('mode', { mode: 'up' });
    await page.getByRole('button', { name: biz.panel.sync }).click();
    await expect(page.getByRole('status').filter({ hasText: biz.panel.syncedSame })).toBeVisible();
    await expect(
      page.getByText(biz.panel.syncProblem.split('{reason}')[0]!, { exact: false }),
    ).toHaveCount(0);
  });

  test('the business can be changed and unlinked, and the English page says the same', async () => {
    await page.goto(`${projectUrl}?tab=business`);
    await page.getByRole('button', { name: biz.panel.change, exact: true }).click();
    const confirm = page.getByRole('group', { name: biz.panel.change });
    await confirm.getByRole('radio', { name: new RegExp(SECOND, 'u') }).check();
    await confirm.getByLabel(biz.panel.reason).fill('پروژهٔ دیگر');
    await confirm.getByRole('button', { name: biz.panel.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: biz.panel.linked })).toBeVisible();
    await expect(page.getByTestId('business-header')).toContainText(SECOND);
    await expect(page.getByTestId('business-version')).toHaveText(digits(1));

    // English page.
    await page.goto(`${projectUrl.replace('/fa/', '/en/')}?tab=business`);
    await expect(page.getByTestId('business-header')).toContainText(bizEn.panel.readOnlyNote);
    await expect(page.getByRole('button', { name: bizEn.panel.sync })).toBeVisible();
    await expect(page.getByTestId('business-section-OVERVIEW')).toContainText('کافه');
    await expectNoSeriousA11yViolations(page);

    // Unlinking leaves the project without a business; the picker is offered again.
    await page.goto(`${projectUrl}?tab=business`);
    await page.getByRole('button', { name: biz.panel.unlink, exact: true }).click();
    await page
      .getByRole('group', { name: biz.panel.unlink })
      .getByRole('button', { name: biz.panel.confirm })
      .click();
    await expect(page.getByRole('heading', { name: biz.panel.notLinked })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(2);
    await page.getByRole('radio', { name: new RegExp(FIRST, 'u') }).check();
    await page.getByRole('button', { name: biz.panel.link }).click();
    await expect(page.getByTestId('business-header')).toContainText(FIRST);
    await expectNoSeriousA11yViolations(page);

    // The project list names the business.
    await page.goto('/fa/projects');
    await expect(page.getByRole('row', { name: new RegExp(`biz-${stamp}`, 'u') })).toContainText(
      FIRST,
    );
  });
});
