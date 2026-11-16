import { expect, test } from '@playwright/test';

import { providerMessages } from '../app/[locale]/providers/messages';
import { searchMessages } from '../app/[locale]/providers/search-messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  revealRow,
  signInWithKeyboard,
} from './support';

const models = providerMessages('fa');
const text = searchMessages('fa');

/** The independent web search services on the providers page (ADR-0060). No network is used: the key is
 * never checked against the real service here, only stored. */
test.describe('web search services', () => {
  test('the section and its form are there, labelled apart from the model connection form', async ({
    page,
  }) => {
    await signInWithKeyboard(page);
    await page.goto('/fa/providers');
    await expect(page.getByRole('heading', { name: text.title })).toBeVisible();
    // The labels differ from the model form's, so each field has one name on the page.
    await expect(page.getByLabel(text.service, { exact: true })).toBeVisible();
    await expect(page.getByLabel(text.apiKey, { exact: true })).toHaveAttribute('type', 'password');
    await expect(page.getByLabel(models.apiKey, { exact: true })).toHaveAttribute(
      'type',
      'password',
    );
    await expect(page.getByRole('button', { name: text.save, exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('a connected service is listed here only, with its fingerprint and price, never as a model', async ({
    page,
  }) => {
    await signInWithKeyboard(page);
    const name = `E2E Exa ${Date.now()}`;
    const secret = 'e2e-exa-key-0123456789';
    await createViaApi<{ connection: { id: string } }>(page, '/provider-connections', {
      provider: 'exa',
      name,
      secret,
      baseUrl: 'http://127.0.0.1:9',
    });
    await page.goto('/fa/providers');
    const row = page.getByRole('row').filter({ hasText: name });
    await revealRow(page, row);
    // One row on the whole page: the model connections table does not list it.
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell', { name: 'exa', exact: true })).toBeVisible();
    await expect(row.getByRole('spinbutton', { name: `${text.cost} — ${name}` })).toHaveValue(
      '0.007',
    );
    // The key is write-only: only a short fingerprint is shown.
    await expect(page.getByText(secret)).toHaveCount(0);
    // And it cannot be chosen as the default model's connection.
    await expect(page.getByLabel(models.connection, { exact: true })).not.toContainText(name);
    await expectNoSeriousA11yViolations(page);
  });

  test('a service can be removed after a confirmation and then disappears', async ({ page }) => {
    await signInWithKeyboard(page);
    const name = `E2E Tavily ${Date.now()}`;
    await createViaApi<{ connection: { id: string } }>(page, '/provider-connections', {
      provider: 'tavily',
      name,
      secret: 'e2e-tavily-key-0123456789',
      baseUrl: 'http://127.0.0.1:9',
    });
    await page.goto('/fa/providers');
    const row = page.getByRole('row').filter({ hasText: name });
    await revealRow(page, row);
    await row.getByRole('button', { name: text.remove, exact: true }).click();
    await expect(page.getByText(text.removeHelp)).toBeVisible();
    await page.getByRole('button', { name: text.removeConfirm }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });
});
