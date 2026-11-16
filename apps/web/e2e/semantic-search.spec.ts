import { expect, test } from '@playwright/test';

import { semanticMessages } from '../app/[locale]/knowledge/semantic-messages';
import { expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

const text = semanticMessages('fa');

/** The semantic search card in Knowledge → Retrieval (ADR-0061). The test stack leaves every
 * `KNOWLEDGE_EMBEDDING_*` lock closed, which is the state an owner starts in: the card must say it
 * is off and why, and offer nothing to press. */
test.describe('semantic search card', () => {
  test('says it is off and why, and has no button while off', async ({ page }) => {
    await signInWithKeyboard(page);
    await page.goto('/fa/knowledge?tab=retrieval');
    await expect(page.getByRole('heading', { name: text.title })).toBeVisible();
    await expect(page.getByText(text.off['not_enabled']!)).toBeVisible();
    await expect(page.getByRole('button', { name: text.run })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('is in English too', async ({ page }) => {
    await signInWithKeyboard(page);
    await page.goto('/en/knowledge?tab=retrieval');
    const english = semanticMessages('en');
    await expect(page.getByRole('heading', { name: english.title })).toBeVisible();
    await expect(page.getByText(english.off['not_enabled']!)).toBeVisible();
  });
});
