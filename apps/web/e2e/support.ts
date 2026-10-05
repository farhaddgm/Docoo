import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { problemMessages } from '../app/[locale]/projects/[projectId]/problem-messages';

const detail = projectPageMessages('fa');
const problemText = problemMessages('fa');

export const email = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@example.test';
export const password = process.env['E2E_ADMIN_PASSWORD'] ?? 'e2e-admin-password-1';

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

/** Signs in on the Persian sign-in page with the keyboard only. */
export async function signInWithKeyboard(page: Page) {
  await page.goto('/fa');
  await page.getByLabel('ایمیل').focus();
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'داشبورد Docoo' })).toBeVisible();
}

/** Workspace of the signed-in administrator and the headers the API's origin check expects. */
export async function apiSession(page: Page) {
  const session = (await (await page.request.get('/api/auth/session')).json()) as {
    workspaces: { id: string }[];
  };
  return {
    workspaceId: session.workspaces[0]!.id,
    headers: { origin: new URL(page.url()).origin, 'sec-fetch-site': 'same-origin' },
  };
}

/** Creates through the API what a test needs but does not exercise (fast, deterministic). */
export async function createViaApi<T>(
  page: Page,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const { workspaceId, headers } = await apiSession(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}${path}`, {
    headers,
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as T;
}

/** Points the workspace at an offline test provider so stages run without a real key. */
export async function useFakeProvider(page: Page) {
  const { workspaceId, headers } = await apiSession(page);
  const created = await createViaApi<{ connection: { id: string } }>(
    page,
    '/provider-connections',
    { provider: 'fake', name: `E2E flow provider ${Date.now()}` },
  );
  const id = created.connection.id;
  await page.request.post(
    `/api/workspaces/${workspaceId}/provider-connections/${id}/models/refresh`,
    {
      headers,
    },
  );
  for (const [key, value] of [
    ['ai.connection_id', id],
    ['ai.model', 'fake-standard'],
  ] as const) {
    const response = await page.request.put(`/api/workspaces/${workspaceId}/settings/assignments`, {
      headers,
      data: { key, scopeType: 'workspace', scopeId: workspaceId, value, reason: 'E2E setup' },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

/**
 * Plays the administrator in the Problem tab until the problem definition waits for a decision:
 * one real answer per batch and the rest marked with the bulk button.
 */
export async function completeAnalysis(page: Page) {
  const wait = { timeout: 60_000 };
  await page.getByRole('button', { name: detail.tabs.problem, exact: true }).click();
  const heading = page.locator('#batch-heading');
  const definition = page.locator('#definition-heading');
  for (let guard = 0; guard < 6; guard += 1) {
    await expect(heading.or(definition)).toBeVisible(wait);
    if (await definition.isVisible()) return;
    const label = (await heading.innerText()).trim();
    await page.locator('form[aria-labelledby="batch-heading"] textarea').first().fill('پاسخ آزمون');
    await page.getByRole('button', { name: problemText.bulk.irrelevant }).click();
    await page.getByRole('button', { name: problemText.save, exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: problemText.saved.complete }),
    ).toBeVisible();
    await expect(heading.filter({ hasText: label })).toHaveCount(0, wait);
  }
  throw new Error('The analysis did not reach a problem definition.');
}
