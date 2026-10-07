import { expect, test } from '@playwright/test';

import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { notificationMessages } from '../app/[locale]/notifications/notification-messages';
import {
  completeAnalysis,
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const detail = projectPageMessages('fa');
const text = notificationMessages('fa');
const stamp = Date.now().toString(36);

/**
 * Notifications in the browser (ADR-0025): a task that waits for the administrator shows up on
 * the bell and on its page, opens the right part of the project, and can be marked read.
 */
test.describe('notifications (NTF-001)', () => {
  test('the bell counts what waits, the page lists it, and reading it clears the count', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const area = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `nt-${stamp}`,
      title: `Notifications ${stamp}`,
    });
    const project = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `nt-${stamp}`,
      title: `Notifications project ${stamp}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId: area.topic.id }],
    });
    await page.goto(`/fa/projects/${project.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(page.locator('.facts .badge').first()).toHaveText(detail.statuses['active']!);
    await completeAnalysis(page);

    // The analysis gate waits for the administrator: the bell says so.
    await page.goto('/fa/notifications');
    await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
    const list = page.getByRole('list', { name: text.title });
    const mine = list.locator('li').filter({ hasText: `nt-${stamp}` });
    await expect(mine.filter({ hasText: text.kinds['gate_review']! })).toBeVisible({
      timeout: 60_000,
    });
    await expect(mine.filter({ hasText: text.kinds['gate_review']! })).toContainText(
      text.stillWaiting,
    );
    // Every batch of questions was a task of its own; all are answered by now.
    await expect(mine.filter({ hasText: text.kinds['analysis_answers']! }).first()).toContainText(
      text.handled,
    );
    await expect(page.getByRole('link', { name: /^اعلان‌ها، .* خوانده‌نشده$/u })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // "Open" goes to the section that deals with it and reads the notification.
    const gate = mine.filter({ hasText: text.kinds['gate_review']! });
    await gate.getByRole('link', { name: text.open }).click();
    await expect(page).toHaveURL(
      new RegExp(`/fa/projects/${project.project.id}\\?tab=workflow`, 'u'),
    );
    await page.goto('/fa/notifications');
    await expect(
      list
        .locator('li')
        .filter({ hasText: `nt-${stamp}` })
        .filter({ hasText: text.kinds['gate_review']! }),
    ).toHaveCount(0);
    await page.getByLabel(text.filter).selectOption('all');
    await expect(
      list
        .locator('li')
        .filter({ hasText: `nt-${stamp}` })
        .filter({ hasText: text.kinds['gate_review']! })
        .getByText(text.read, { exact: true }),
    ).toBeVisible();

    // Everything can be marked read at once, and the bell goes back to its plain label.
    await page.getByRole('button', { name: text.markAllRead }).click();
    await expect(page.getByRole('status').filter({ hasText: text.allDone })).toBeVisible();
    await page.getByLabel(text.filter).selectOption('unread');
    await expect(page.getByText(text.empty)).toBeVisible();
    await expect(page.getByRole('link', { name: text.bell, exact: true })).toBeVisible();

    // English, left to right.
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/notifications$/u);
    await expect(
      page.getByRole('heading', { level: 1, name: notificationMessages('en').title }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
