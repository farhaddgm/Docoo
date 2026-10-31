import { expect, test, type Page } from '@playwright/test';

import { explorationMessages } from '../app/[locale]/explorations/messages';
import { expectNoSeriousA11yViolations, signInWithKeyboard, useFakeProvider } from './support';

/**
 * Explorations in the backoffice (ADR-0044 P1): start one from an event, talk to the analyst, ask
 * for candidate problems, write and edit one by hand, and park, drop and bring candidates back.
 */
async function openNew(page: Page, locale: 'fa' | 'en', title: string, event: string) {
  const text = explorationMessages(locale);
  await page.goto(`/${locale}/explorations`);
  await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
  await page.locator('#exploration-title').fill(title);
  await page.locator('#exploration-event').fill(event);
  await page.getByRole('button', { name: text.createSubmit }).click();
  await expect(page.getByText(text.created)).toBeVisible();
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(/\/explorations\/[0-9a-f-]{36}$/u);
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(title, 'u') })).toBeVisible();
}

for (const locale of ['fa', 'en'] as const) {
  test(`${locale}: from an event to candidate problems, decisions and back (ADR-0044)`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const text = explorationMessages(locale);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const stamp = Date.now().toString(36);
    const title = locale === 'fa' ? `ریزش مشتریان بزرگ ${stamp}` : `Large clients left ${stamp}`;
    await page.goto(`/${locale}/explorations`);
    await expectNoSeriousA11yViolations(page);
    await openNew(
      page,
      locale,
      title,
      locale === 'fa'
        ? 'سه مشتری بزرگ ما این ماه قراردادشان را لغو کردند.'
        : 'Three of our biggest clients cancelled this month.',
    );
    await expectNoSeriousA11yViolations(page);

    // The conversation: the analyst answers in plain text and the count goes up.
    await page
      .locator('textarea[id$="-message"]')
      .fill(locale === 'fa' ? 'به چه چیزهایی فکر کنم؟' : 'What should I think about?');
    await page.getByRole('button', { name: text.send, exact: true }).click();
    const conversation = page.getByRole('list', { name: text.conversation });
    await expect(conversation.getByRole('listitem')).toHaveCount(2);
    await expect(conversation.getByText(text.analyst, { exact: true })).toBeVisible();
    await expect(
      page.getByText(locale === 'fa' ? '۱ از ۴۰ پیام' : '1 of 40 messages'),
    ).toBeVisible();

    // The model proposes candidates; nothing is decided or made a project by itself.
    await page.getByRole('button', { name: text.propose }).click();
    const cards = page
      .locator('section', { hasText: text.candidatesHeading })
      .getByRole('listitem');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText(text.proposed)).toBeVisible();
    await expect(page.getByText(text.states.proposed, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `${text.filters.all} (${locale === 'fa' ? '۲' : '2'})`,
      }),
    ).toBeVisible();

    // Parking, then bringing back, with a reason; the filters follow.
    const filters = page.getByRole('group', { name: text.candidatesHeading });
    const first = cards.first();
    await first
      .getByPlaceholder(text.reasonLabel)
      .fill(locale === 'fa' ? 'فعلاً زود است' : 'Too early');
    await first.getByRole('button', { name: text.decisions.parked }).click();
    await expect(page.getByText(text.decided)).toBeVisible();
    await filters.getByRole('button', { name: new RegExp(`^${text.filters.parked}`, 'u') }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByText(text.states.parked, { exact: true })).toBeVisible();
    await cards.first().getByRole('button', { name: text.decisions.proposed }).click();
    await expect(cards).toHaveCount(0);
    await filters.getByRole('button', { name: new RegExp(`^${text.filters.all}`, 'u') }).click();

    // A hand-written candidate, edited into a second version.
    await page.getByRole('button', { name: text.addByHand }).click();
    await page
      .locator('input[id$="-title"]')
      .last()
      .fill(locale === 'fa' ? 'قیمت‌گذاری رقبا' : 'Competitor pricing');
    await page
      .locator('textarea[id$="-problem"]')
      .last()
      .fill(locale === 'fa' ? 'رقبا ارزان‌تر شده‌اند.' : 'Competitors got cheaper.');
    await page.getByRole('button', { name: text.addSubmit }).click();
    await expect(page.getByText(text.added)).toBeVisible();
    const mine = page
      .getByRole('listitem')
      .filter({ hasText: locale === 'fa' ? 'قیمت‌گذاری رقبا' : 'Competitor pricing' });
    await mine.getByRole('button', { name: text.edit }).click();
    await page
      .locator('textarea[id$="-why"]')
      .last()
      .fill(locale === 'fa' ? 'فروش را می‌برد.' : 'It costs sales.');
    await page.getByRole('button', { name: text.editSave }).click();
    await expect(page.getByText(text.edited)).toBeVisible();
    await expect(
      mine.getByText(text.version.replace('{n}', locale === 'fa' ? '۲' : '2')),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Archiving stops new messages but a parked or dropped candidate can still be brought back.
    await page.getByRole('button', { name: text.archive, exact: true }).click();
    await expect(page.getByText(text.archivedDone)).toBeVisible();
    await expect(page.locator('textarea[id$="-message"]')).toBeDisabled();
    await expect(page.getByRole('button', { name: text.propose })).toBeDisabled();
    await expect(page.getByRole('button', { name: text.decisions.dropped }).first()).toBeEnabled();
    await page.getByRole('button', { name: text.reopen, exact: true }).click();
    await expect(page.getByText(text.reopenedDone)).toBeVisible();
    await expect(page.locator('textarea[id$="-message"]')).toBeEnabled();

    // The list shows what is in it.
    await page.getByRole('link', { name: text.back }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
}

test('the explorations entry is in the menu right under the projects', async ({ page }) => {
  await signInWithKeyboard(page);
  await page.goto('/fa');
  const nav = page.getByRole('navigation', { name: 'ناوبری اصلی' });
  const labels = await nav.getByRole('link').allTextContents();
  const projects = labels.findIndex((label) => label.includes('پروژه‌ها'));
  expect(projects).toBeGreaterThanOrEqual(0);
  expect(labels[projects + 1]).toContain(explorationMessages('fa').title);
});
