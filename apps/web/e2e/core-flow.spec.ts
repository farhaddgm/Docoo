import { expect, test, type Page } from '@playwright/test';

import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { workflowMessages } from '../app/[locale]/projects/[projectId]/workflow-messages';
import { projectMessages } from '../app/[locale]/projects/messages';
import { topicMessages } from '../app/[locale]/topics/messages';
import {
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

// Texts come from the same message modules the pages use, so a wording change cannot break
// these tests while a behaviour change still does.
const topicText = topicMessages('fa');
const projectText = projectMessages('fa');
const detail = projectPageMessages('fa');
const flow = workflowMessages('fa');
const stamp = Date.now().toString(36);

const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'ناوبری اصلی' });
const failureNotice = (page: Page) => page.locator('.notice.error[role="alert"]');
const statusBadge = (page: Page) => page.locator('.facts .badge').first();

test.describe('topics, projects and workflow in the backoffice (TOP-001, PRJ-001, WF-003)', () => {
  test('topics: create, edit, archive and restore (TOP-001)', async ({ page }) => {
    await signInWithKeyboard(page);
    const code = `topic-${stamp}`;

    await mainNavigation(page).getByRole('link', { name: 'حوزه‌های موضوعی' }).click();
    await expect(page).toHaveURL(/\/fa\/topics$/u);
    await expect(page.getByRole('heading', { level: 1, name: topicText.title })).toBeVisible();
    await expect(
      mainNavigation(page).getByRole('link', { name: 'حوزه‌های موضوعی' }),
    ).toHaveAttribute('aria-current', 'page');

    await page.locator('#topic-code').fill(code);
    await page.locator('#topic-title').fill('بازار هدف');
    await page.locator('#topic-description').fill('تحلیل بازار مشتریان');
    await page.getByRole('button', { name: topicText.createSubmit }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.created })).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: code }) });
    await expect(row).toContainText('بازار هدف');
    await expectNoSeriousA11yViolations(page);

    // Edit keeps the version history: the page sends If-Match with the loaded version.
    await row.getByRole('button', { name: topicText.edit }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: topicText.editTitle.replace('{code}', code) }),
    ).toBeFocused();
    await page.locator('#edit-title').fill('بازار هدف (بازنگری‌شده)');
    await page.locator('#edit-reason').fill('اصلاح عنوان');
    await page.getByRole('button', { name: topicText.save }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.updatedDone })).toBeVisible();
    await expect(row).toContainText('بازنگری‌شده');
    await expect(row.getByRole('cell').nth(2)).toHaveText('۲'); // version 2, in Persian digits

    // Archive shows its effect first and moves the topic to the archived view.
    await row.getByRole('button', { name: topicText.archive }).click();
    await expect(page.locator('#confirm-title')).toBeFocused();
    await expect(page.getByText(topicText.archiveEffect)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: topicText.confirm }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.archived })).toBeVisible();
    await expect(row).toHaveCount(0);

    await page.locator('#topic-view').selectOption('archived');
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: topicText.restore }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.restored })).toBeVisible();
    await page.locator('#topic-view').selectOption('active');
    await expect(row).toHaveCount(1);
  });

  test('projects: prioritized topics, lifecycle with reasons, edit and guarded delete (PRJ-001)', async ({
    page,
  }) => {
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const first = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `pa-${stamp}`,
      title: 'حوزهٔ اول',
    });
    const second = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `pb-${stamp}`,
      title: 'حوزهٔ دوم',
    });

    await mainNavigation(page).getByRole('link', { name: 'پروژه‌ها' }).click();
    await expect(page).toHaveURL(/\/fa\/projects$/u);
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('link', { name: projectText.newProject }).click();
    await expect(page).toHaveURL(/\/fa\/projects\/new$/u);

    const code = `prj-${stamp}`;
    await page.locator('#project-code').fill(code);
    await page.locator('#project-title').fill('پروژهٔ آزمون');
    await page.locator('#project-problem').fill('فروش آنلاین کند شده و علت آن را نمی‌دانیم.');
    const picker = page.locator('#project-add-topic');
    await picker.selectOption(first.topic.id);
    await page.getByRole('button', { name: projectText.addTopic }).click();
    await picker.selectOption(second.topic.id);
    await page.getByRole('button', { name: projectText.addTopic }).click();
    const order = page.locator('.priority-list > li');
    await expect(order).toHaveCount(2);
    await expect(order.first()).toContainText('حوزهٔ اول');
    await page.getByRole('button', { name: `${projectText.moveDown}: حوزهٔ اول` }).click();
    await expect(order.first()).toContainText('حوزهٔ دوم');
    await expectNoSeriousA11yViolations(page);
    await page.getByRole('button', { name: projectText.createSubmit }).click();

    await expect(page).toHaveURL(/\/fa\/projects\/[0-9a-f-]{36}$/u);
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(code, 'u') }),
    ).toBeVisible();
    await expect(statusBadge(page)).toHaveText(detail.statuses['draft']!);
    await expect(page.getByRole('button', { name: detail.commands['pause']! })).toHaveCount(0);
    const topicItems = page.locator('#topics-title').locator('xpath=following-sibling::ol/li');
    await expect(topicItems.first()).toContainText('حوزهٔ دوم'); // saved in the chosen priority
    await expectNoSeriousA11yViolations(page);

    // Activate, then pause: a reason is required and the pause reason stays visible.
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    const pause = page.getByRole('button', { name: detail.commands['pause']! });
    await pause.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#command-title')).toBeFocused();
    await page.getByRole('button', { name: detail.confirm }).click();
    await expect(page.locator('#command-reason:invalid')).toHaveCount(1);
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    await page.locator('#command-reason').fill('نیاز به بازبینی دستی');
    await page.getByRole('button', { name: detail.confirm }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['paused']!);
    await expect(page.getByText('نیاز به بازبینی دستی')).toBeVisible();
    await page.getByRole('button', { name: detail.commands['resume']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);

    // The problem is locked once the project left draft; other fields stay editable.
    await page.getByRole('button', { name: detail.edit }).click();
    await expect(page.locator('#project-problem')).toBeDisabled();
    await page.locator('#project-title').fill('پروژهٔ آزمون بازنگری‌شده');
    await page.getByRole('button', { name: projectText.saveChanges }).click();
    await expect(page.getByRole('heading', { level: 2, name: /بازنگری‌شده/u })).toBeVisible();

    // Archive shows its effect, makes the project read-only and unarchive restores it.
    await page.getByRole('button', { name: detail.commands['archive']! }).click();
    await expect(page.getByText(detail.effects['archive']!)).toBeVisible();
    await page.getByRole('button', { name: detail.confirm }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['archived']!);
    await expect(page.getByRole('button', { name: detail.edit })).toHaveCount(0);
    await page.getByRole('button', { name: detail.commands['unarchive']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);

    // A topic that a project uses cannot be deleted; the panel names the project first.
    await mainNavigation(page).getByRole('link', { name: 'حوزه‌های موضوعی' }).click();
    const usedRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: `pa-${stamp}` }) });
    await usedRow.getByRole('button', { name: topicText.remove }).click();
    await expect(page.locator('#confirm-title')).toBeFocused();
    await expect(page.locator('.confirm-panel')).toContainText(code);
    await page.getByRole('button', { name: topicText.confirm }).click();
    await expect(failureNotice(page)).toContainText(topicText.errors['TOPIC_HAS_DEPENDENCIES']!);

    // The same project in English keeps the session and the layout direction.
    await page.goto(`/en/projects`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: code })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('a project without topics cannot be activated and says why (PRJ-001)', async ({ page }) => {
    await signInWithKeyboard(page);
    const bare = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `bare-${stamp}`,
      title: 'بدون حوزه',
      initialProblem: 'مسئله‌ای بدون حوزه',
    });
    await page.goto(`/fa/projects/${bare.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(failureNotice(page)).toContainText(projectText.notReady['topics_missing']!);
    await expect(statusBadge(page)).toHaveText(detail.statuses['draft']!);
  });

  test('workflow: reject with feedback, edit and approve every stage (WF-003, WF-006)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `ft-${stamp}`,
      title: 'حوزهٔ جریان',
    });
    const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `flow-${stamp}`,
      title: 'جریان کامل',
      initialProblem: 'مسئلهٔ آزمون جریان کار',
      topics: [{ topicId: topic.topic.id }],
    });
    await page.goto(`/fa/projects/${created.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    await page.getByRole('button', { name: detail.tabs.workflow }).click();
    await expect(page).toHaveURL(/[?&]tab=workflow/u);

    const review = (stage: string) => page.locator(`#review-title-${stage}`);
    const comment = (stage: string) => page.locator(`#review-comment-${stage}`);
    const waiting = { timeout: 60_000 };

    // Analysis: a rejection needs feedback, then the second attempt arrives as version 2.
    await expect(review('analysis')).toBeVisible(waiting);
    await expectNoSeriousA11yViolations(page);
    const reject = page.getByRole('button', { name: flow.reject });
    await expect(reject).toBeDisabled();
    await comment('analysis').fill('فرض‌ها را دقیق‌تر بنویسید');
    await reject.click();
    await expect(page.getByRole('status').filter({ hasText: flow.done.rejected })).toBeVisible();
    await expect(page.getByText(flow.outputVersion.replace('{n}', '۲'))).toBeVisible(waiting);

    // Edit creates version 3 that waits for approval; the earlier approval cannot count.
    await page.getByRole('button', { name: flow.editToggle }).click();
    const editor = page.locator('#edit-content-analysis');
    const edited = JSON.parse(await editor.inputValue()) as Record<string, unknown>;
    edited['problemStatement'] = 'بیان مسئلهٔ اصلاح‌شده توسط ادمین';
    await editor.fill(JSON.stringify(edited, null, 2));
    await page.locator('#edit-reason-analysis').fill('اصلاح بیان مسئله');
    await page.getByRole('button', { name: flow.editSave }).click();
    await expect(page.getByRole('status').filter({ hasText: flow.done.edited })).toBeVisible();
    await expect(page.getByText(flow.outputVersion.replace('{n}', '۳'))).toBeVisible(waiting);
    await expect(page.getByText('بیان مسئلهٔ اصلاح‌شده توسط ادمین').first()).toBeVisible();

    // Approve every stage in order until the run completes.
    for (const stage of ['analysis', 'research', 'ideation', 'documentation', 'evaluation']) {
      await expect(review(stage)).toBeVisible(waiting);
      await page.getByRole('button', { name: flow.approve }).click();
      await expect(page.getByRole('status').filter({ hasText: flow.done.approved })).toBeVisible();
    }
    await expect(page.getByText(/اجرای شماره\S* ۱/u)).toContainText(
      flow.runStatuses['completed']!,
      waiting,
    );
    await expect(page.locator('.stage-list .badge.state-completed')).toHaveCount(5);
    await expectNoSeriousA11yViolations(page);

    // The timeline records the decisions.
    await page.getByRole('button', { name: detail.tabs.timeline }).click();
    await expect(page.getByRole('rowheader', { name: /workflow\.approve/u }).first()).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /workflow\.output_edited/u })).toBeVisible();

    // English view of the finished workflow.
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}\?tab=timeline$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Project' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('a missing project says so instead of failing silently', async ({ page }) => {
    await signInWithKeyboard(page);
    await page.goto('/fa/projects/00000000-0000-4000-8000-000000000000');
    await expect(failureNotice(page)).toContainText(detail.notFound);
  });
});
