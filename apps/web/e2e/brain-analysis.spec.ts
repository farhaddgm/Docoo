import { expect, test, type Page } from '@playwright/test';

import { brainMessages } from '../app/[locale]/brain/brain-messages';
import { apiSession, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const text = brainMessages('fa');
const english = brainMessages('en');

/**
 * The Brain page (ADR-0033): the administrator chooses what to check, Brain ranks what it
 * found with evidence, and nothing changes until a proposed action is approved. `prepare.mjs`
 * seeds a draft knowledge item that has waited ten days for its audit.
 */
test.describe('Brain analysis and approved actions (FR-BRN-003..005)', () => {
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

  test('checks everything, ranks the findings and keeps the explanation short', async () => {
    await page.goto('/fa/brain');
    await expect(page.getByRole('heading', { level: 1, name: 'گزارش Brain' })).toBeVisible();
    await expect(page.getByLabel(text.scope)).toHaveValue('');
    await expect(page.getByLabel(text.period)).toHaveValue('30');
    await page.getByLabel(text.period).selectOption('90');

    await page.getByRole('button', { name: text.run, exact: true }).click();
    await expect(page.locator('#report-title')).toBeFocused();
    await expect(page.getByRole('heading', { name: text.findings })).toBeVisible();

    const finding = page.locator('[data-finding="knowledge_unaudited"]');
    await expect(finding).toBeVisible();
    await expect(finding).toContainText(text.kinds['knowledge_unaudited']!.title);
    await expect(finding.getByText(text.severity['medium']!, { exact: true })).toBeVisible();
    await expect(
      finding.getByRole('link', { name: text.actions['open_knowledge']! }),
    ).toBeVisible();
    // Evidence names a record and links to it.
    await expect(
      finding.getByRole('link', { name: new RegExp(text.evidenceTypes['knowledge']!) }).first(),
    ).toBeVisible();
    // The detail for specialists is folded away.
    await expect(page.locator('summary', { hasText: text.roleDetails })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('changes nothing until an action is approved, then records it', async () => {
    const finding = page.locator('[data-finding="knowledge_unaudited"]');
    const audit = finding.getByRole('button', { name: text.actions['audit_knowledge']! }).first();
    await audit.click();
    const group = finding.getByRole('group').first();
    await expect(group).toContainText(text.confirmText['audit_knowledge']!);
    await expectNoSeriousA11yViolations(page);

    // Cancelling leaves everything as it was.
    await group.getByRole('button', { name: text.cancel }).click();
    await expect(audit).toBeVisible();
    await expect(finding.getByText(text.decisions['done']!)).toHaveCount(0);

    await audit.click();
    await group.getByRole('button', { name: text.approve }).click();
    await expect(finding.getByText(text.decisions['done']!)).toBeVisible();

    // The decision survives a reload and is in the audit log.
    await page.reload();
    await expect(
      page
        .locator('[data-finding="knowledge_unaudited"]')
        .getByText(text.decisions['done']!)
        .first(),
    ).toBeVisible();
    const { workspaceId, headers } = await apiSession(page);
    const events = await page.request.get(
      `/api/workspaces/${workspaceId}/audit-events?action=brain.action_approved`,
      { headers },
    );
    expect(events.ok(), await events.text()).toBe(true);
    expect(((await events.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  test('is complete in English too', async () => {
    await page.goto('/en/brain');
    await expect(page.getByRole('heading', { level: 1, name: 'Brain report' })).toBeVisible();
    await expect(page.getByLabel(english.scope)).toBeVisible();
    await page.getByRole('button', { name: english.run, exact: true }).click();
    await expect(page.getByRole('heading', { name: english.findings })).toBeVisible();
    await expect(page.getByText(english.unchanged)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
