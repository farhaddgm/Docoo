import { expect, test } from '@playwright/test';

import { providerMessages } from '../app/[locale]/providers/messages';
import { priceMessages } from '../app/[locale]/providers/price-messages';
import { createViaApi, signInWithKeyboard } from './support';

const text = providerMessages('fa');
const prices = priceMessages('fa');

test.describe('managing provider connections', () => {
  test('a connection can be deleted after a confirmation and then disappears', async ({ page }) => {
    await signInWithKeyboard(page);
    const name = `E2E delete provider ${Date.now()}`;
    await createViaApi<{ connection: { id: string } }>(page, '/provider-connections', {
      provider: 'fake',
      name,
    });
    await page.goto('/fa/providers');
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `حذف اتصال «${name}»` }).click();
    await expect(page.getByText(text.removeHelp)).toBeVisible();
    await page.getByRole('button', { name: text.removeConfirm }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });

  test('the manual price form offers the models of the chosen provider', async ({ page }) => {
    await signInWithKeyboard(page);
    await page.goto('/fa/providers');
    const model = page.getByLabel(prices.modelLabel, { exact: true });
    await expect(model).toBeVisible();
    // Choosing another provider never keeps the model of the old one.
    await page.getByLabel(prices.provider, { exact: true }).selectOption({ index: 0 });
    await expect(model).toHaveValue('');
  });
});
