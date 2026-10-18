import { expect, test } from '@playwright/test';

import { providerMessages } from '../app/[locale]/providers/messages';
import {
  apiSession,
  createViaApi,
  expectNoSeriousA11yViolations,
  revealRow,
  signInWithKeyboard,
} from './support';

test('provider concurrency edits persist across reload and both languages', async ({ page }) => {
  await signInWithKeyboard(page);
  const created = await createViaApi<{
    connection: { id: string; name: string; maxConcurrentInvocations: number };
  }>(page, '/provider-connections', { provider: 'fake', name: 'Capacity browser ' + Date.now() });
  expect(created.connection.maxConcurrentInvocations).toBe(4);
  const { workspaceId } = await apiSession(page);
  const savedLimit = async () => {
    const response = await page.request.get(
      `/api/workspaces/${workspaceId}/provider-connections/${created.connection.id}`,
    );
    expect(response.status()).toBe(200);
    return (await response.json()).connection.maxConcurrentInvocations as number;
  };
  for (const [locale, value] of [
    ['fa', '2'],
    ['en', '3'],
  ] as const) {
    const text = providerMessages(locale);
    await page.goto(`/${locale}/providers`);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: created.connection.name, exact: true }) });
    const input = row.getByRole('spinbutton');
    await revealRow(page, row);
    await expect(input).toHaveAccessibleName(`${text.maxConcurrent} — ${created.connection.name}`);
    await expect(input).toHaveValue(locale === 'fa' ? '4' : '2');
    await input.fill(value);
    await row.getByRole('button', { name: text.saveCapacity, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: text.saved })).toBeVisible();
    await expect.poll(savedLimit).toBe(Number(value));
    await page.reload();
    await revealRow(page, row);
    await expect(input).toHaveValue(value);
    await input.fill('0');
    await row.getByRole('button', { name: text.saveCapacity, exact: true }).click();
    expect(
      await input.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow),
    ).toBe(true);
    expect(await savedLimit()).toBe(Number(value));
    await input.fill(value);
    // Scan with the field mid-screen, as a person sees it: scrolling only until it shows can leave
    // it under the sticky top bar, which the touch-target rule counts as covering it.
    await input.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expectNoSeriousA11yViolations(page);
  }
});
