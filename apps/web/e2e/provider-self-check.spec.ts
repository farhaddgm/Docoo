import { expect, test } from '@playwright/test';

import { selfCheckMessages } from '../app/[locale]/providers/self-check-messages';
import { createViaApi, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const text = selfCheckMessages('fa');

/**
 * The one-click model test on the providers page: every kind of call the platform makes is tried
 * one by one against the chosen connection and model, and the outcome can be copied (ADR-0020).
 * The offline test provider stands in for a real key.
 */
test.describe('model self-check (AI-006)', () => {
  test('runs every kind of call, shows the result and a copyable report', async ({ page }) => {
    test.setTimeout(180_000);
    await signInWithKeyboard(page);
    const created = await createViaApi<{ connection: { id: string; name: string } }>(
      page,
      '/provider-connections',
      { provider: 'fake', name: `E2E self-check provider ${Date.now()}` },
    );
    await page.goto('/fa/providers');
    await expect(page.getByRole('heading', { level: 2, name: text.title })).toBeVisible();

    await page.getByLabel(text.connection, { exact: true }).selectOption(created.connection.id);
    await page.getByLabel(text.model, { exact: true }).fill('fake-standard');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: text.start }).click();

    const table = page.getByRole('table', { name: text.caption });
    await expect(table).toBeVisible();
    // Every step ends passed, one after another.
    for (const label of Object.values(text.steps)) {
      await expect(table.getByRole('rowheader', { name: label })).toBeVisible();
    }
    await expect(page.getByText(/همهٔ .* مرحله موفق بود/u)).toBeVisible({ timeout: 150_000 });
    await expect(table.getByText(text.failed)).toHaveCount(0);
    await expect(table.getByText(text.passed)).toHaveCount(Object.keys(text.steps).length);

    // The report names every step and can be copied.
    const report = page.getByLabel(text.report);
    await expect(report).toBeVisible();
    for (const step of Object.keys(text.steps)) await expect(report).toContainText(step);
    await expectNoSeriousA11yViolations(page);
  });

  test('a model the provider refuses is reported with the reason', async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    const created = await createViaApi<{ connection: { id: string } }>(
      page,
      '/provider-connections',
      { provider: 'fake', name: `E2E self-check refused ${Date.now()}` },
    );
    await page.goto('/fa/providers');
    await page.getByLabel(text.connection, { exact: true }).selectOption(created.connection.id);
    await page.getByLabel(text.model, { exact: true }).fill('fake-refused-model');
    await page.getByRole('button', { name: text.start }).click();

    await expect(page.getByText(/مرحله از .* ناموفق بود/u)).toBeVisible({ timeout: 120_000 });
    const table = page.getByRole('table', { name: text.caption });
    await expect(table.getByText(text.failed)).toHaveCount(Object.keys(text.steps).length);
    // The reason the provider gave and what it usually means are both in the table and report.
    await expect(table.getByText(/does not support structured output/u).first()).toBeVisible();
    await expect(table.getByText(text.kinds['invalid_request']!).first()).toBeVisible();
    await expect(page.getByLabel(text.report)).toContainText('fake_model_refused');
    await expectNoSeriousA11yViolations(page);
  });
});
