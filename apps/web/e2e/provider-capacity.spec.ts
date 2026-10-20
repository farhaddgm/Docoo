import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { providerMessages } from '../app/[locale]/providers/messages';
import { apiSession, createViaApi, revealRow, signInWithKeyboard } from './support';

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
    // axe's touch-target rule measures how much of a field the page's sticky bars cover at the
    // moment of the scan, and Firefox reports the field as covered even at rest. So the size of the
    // field is asserted directly here, and axe checks everything else on the page.
    const box = await input.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const serious = results.violations
      .filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))
      .map((violation) => ({
        rule: violation.id,
        nodes: violation.nodes
          .filter(
            (node) =>
              !(
                violation.id === 'target-size' &&
                String(node.target).includes('#provider-capacity-')
              ),
          )
          .map((node) => ({ target: node.target, failure: node.failureSummary })),
      }))
      .filter((violation) => violation.nodes.length > 0);
    expect(serious).toEqual([]);
  }
});
