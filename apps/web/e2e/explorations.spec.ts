import { expect, test } from '@playwright/test';

import { projectMessages } from '../app/[locale]/projects/messages';
import { createViaApi, expectNoSeriousA11yViolations, signInWithKeyboard } from './support';

/**
 * Explorations are projects of kind exploration (ADR-0045 step F): the menu entry lists only
 * them, the list opens the wizard for a new one, and the projects list keeps the ordinary ones.
 */
for (const locale of ['fa', 'en'] as const) {
  test(`${locale}: the Explorations entry lists only projects of kind exploration`, async ({
    page,
  }) => {
    const text = projectMessages(locale);
    const stamp = Date.now().toString(36);
    await signInWithKeyboard(page);
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `ex-${locale}-${stamp}`,
      title: `Topic ${locale} ${stamp}`,
    });
    const make = (code: string, title: string, kind?: 'exploration') =>
      createViaApi(page, '/projects', {
        code,
        title,
        initialProblem: 'An event to understand',
        topics: [{ topicId: topic.topic.id }],
        ...(kind ? { kind } : {}),
      });
    // The code is the link of a row; the title is a plain cell next to it.
    const exploration = `ex-${locale}-${stamp}`;
    const ordinary = `or-${locale}-${stamp}`;
    await make(exploration, `Exploration ${locale} ${stamp}`, 'exploration');
    await make(ordinary, `Ordinary ${locale} ${stamp}`);

    await page.goto(`/${locale}/explorations`);
    await expect(
      page.getByRole('heading', { level: 1, name: text.explorationsTitle }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: exploration })).toBeVisible();
    await expect(page.getByRole('link', { name: ordinary })).toHaveCount(0);
    // Only the exploration wizard is offered here, and the kind filter is not (it is fixed).
    const create = page.getByRole('link', { name: text.newExploration });
    await expect(create).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/projects/new\\?kind=exploration$`, 'u'),
    );
    await expect(page.getByRole('link', { name: text.newProject, exact: true })).toHaveCount(0);
    await expect(page.locator('#project-kind')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // The ordinary list still shows both kinds and can filter.
    await page.goto(`/${locale}/projects`);
    await expect(page.getByRole('link', { name: ordinary })).toBeVisible();
    await expect(page.getByRole('link', { name: exploration })).toBeVisible();
    await page.locator('#project-kind').selectOption('exploration');
    await expect(page.getByRole('link', { name: ordinary })).toHaveCount(0);
    await expect(page.getByRole('link', { name: exploration })).toBeVisible();
  });
}
