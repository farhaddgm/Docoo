import { expect, test } from '@playwright/test';

import { fill } from '../app/[locale]/agents/agent-messages';
import { catalogMessages } from '../app/[locale]/providers/catalog-messages';
import { priceMessages } from '../app/[locale]/providers/price-messages';
import { formatPrice } from '../app/i18n';
import { createViaApi, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const text = catalogMessages('fa');
const prices = priceMessages('fa');
const pair = (input: number, output: number) =>
  `${formatPrice('fa', input)} / ${formatPrice('fa', output)}`;

/**
 * Prices from the public catalog (ADR-0022): the preview shows the catalog next to the price in use,
 * a price the catalog calls free is never offered, and only what is chosen is saved. A stand-in
 * serves the catalog (e2e/fake-contenter.mjs); the test never reaches the internet.
 */
test.describe('model prices from the public catalog', () => {
  test('previews the catalog next to the current price and saves only what is chosen', async ({
    page,
  }) => {
    await signInWithKeyboard(page);
    // A hand-typed price that disagrees with the catalog (new on every run, so the model is
    // "changed" even on a database that already took the catalog price), and one the catalog calls free.
    const earlier = new Date(Date.now() - 300).toISOString();
    const typedInput = 1 + (Date.now() % 900) / 1000;
    for (const [model, input, output] of [
      ['gpt-e2e-catalog', typedInput, 4],
      ['gpt-e2e-free', 3, 9],
    ] as const) {
      await createViaApi(page, '/model-prices', {
        provider: 'openai',
        model,
        inputPerMillion: input,
        outputPerMillion: output,
        effectiveFrom: earlier,
      });
    }

    await page.goto('/fa/providers');
    await expect(page.getByRole('heading', { level: 3, name: text.title })).toBeVisible();
    await page.getByRole('button', { name: text.fetch }).click();

    const table = page.getByRole('table', { name: text.caption });
    await expect(table).toBeVisible();
    const changed = table.getByRole('row').filter({ hasText: 'gpt-e2e-catalog' });
    await expect(changed.getByText(text.statuses.changed)).toBeVisible();
    await expect(changed.getByText(pair(2.5, 10))).toBeVisible();
    await expect(changed.getByText(prices.sourceManual, { exact: false })).toBeVisible();
    // An exact match that differs is chosen for you; a price the catalog calls free is never offered.
    await expect(page.getByLabel(`${text.select}: gpt-e2e-catalog`)).toBeChecked();
    const free = table.getByRole('row').filter({ hasText: 'gpt-e2e-free' });
    await expect(free.getByText(text.statuses.unusable)).toBeVisible();
    await expect(free.getByText(text.reasons.zero_price)).toBeVisible();
    await expect(page.getByLabel(`${text.select}: gpt-e2e-free`)).toBeDisabled();
    await expectNoSeriousA11yViolations(page);

    // Nothing chosen, nothing to save.
    await page.getByLabel(`${text.select}: gpt-e2e-catalog`).uncheck();
    await expect(page.getByRole('button', { name: /ثبت .* قیمت انتخاب‌شده/u })).toBeDisabled();
    await page.getByLabel(`${text.select}: gpt-e2e-catalog`).check();
    await page.getByRole('button', { name: /ثبت .* قیمت انتخاب‌شده/u }).click();

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: fill(text.saved, { imported: '۱', skipped: '۰' }) }),
    ).toBeVisible();
    // The preview is gone and the price list now holds the catalog price, marked as such.
    await expect(table).toHaveCount(0);
    const list = page.getByRole('table', { name: prices.caption });
    const saved = list.getByRole('row').filter({ hasText: 'gpt-e2e-catalog' });
    await expect(saved.getByText(prices.sourceCatalog, { exact: true })).toBeVisible();
    await expect(saved.getByText(formatPrice('fa', 2.5), { exact: true })).toBeVisible();
    // The free model keeps the price typed by hand.
    const kept = list.getByRole('row').filter({ hasText: 'gpt-e2e-free' });
    await expect(kept.getByText(prices.sourceManual, { exact: true })).toBeVisible();

    // Asking again: the saved price now equals the catalog's.
    await page.getByRole('button', { name: text.fetch }).click();
    const again = page
      .getByRole('table', { name: text.caption })
      .getByRole('row')
      .filter({ hasText: 'gpt-e2e-catalog' });
    await expect(again.getByText(text.statuses.same)).toBeVisible();
    await expect(page.getByLabel(`${text.select}: gpt-e2e-catalog`)).toBeDisabled();
  });
});
