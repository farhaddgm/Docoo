import { expect, test, type Page } from '@playwright/test';

import { documentMessages } from '../app/[locale]/projects/[projectId]/document-messages';
import { healthMessages } from '../app/[locale]/projects/[projectId]/health-messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { problemMessages } from '../app/[locale]/projects/[projectId]/problem-messages';
import { solutionMessages } from '../app/[locale]/projects/[projectId]/solution-messages';
import { workflowMessages } from '../app/[locale]/projects/[projectId]/workflow-messages';
import { projectMessages } from '../app/[locale]/projects/messages';
import { wizardMessages } from '../app/[locale]/projects/new/wizard-messages';
import { topicMessages } from '../app/[locale]/topics/messages';
import {
  apiSession,
  completeAnalysis,
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

// Texts come from the same message modules the pages use, so a wording change cannot break
// these tests while a behaviour change still does.
const topicText = topicMessages('fa');
const projectText = projectMessages('fa');
const wizardText = wizardMessages('fa');
const detail = projectPageMessages('fa');
const flow = workflowMessages('fa');
const solutionText = solutionMessages('fa');
const documentText = documentMessages('fa');
const problemText = problemMessages('fa');
const stamp = Date.now().toString(36);
const titles = {
  market: `بازار هدف ${stamp}`,
  marketEdited: `بازار هدف بازنگری‌شده ${stamp}`,
  first: `حوزهٔ اول ${stamp}`,
  second: `حوزهٔ دوم ${stamp}`,
  flow: `حوزهٔ جریان ${stamp}`,
  solutions: `حوزهٔ راه‌حل ${stamp}`,
  analysis: `حوزهٔ تحلیل ${stamp}`,
};

/** Persian digits, as the pages show numbers. */
const digits = (value: number) => new Intl.NumberFormat('fa').format(value);

const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'ناوبری اصلی' });
const failureNotice = (page: Page) => page.locator('.notice.error[role="alert"]');
const statusBadge = (page: Page) => page.locator('.facts .badge').first();
const health = healthMessages('fa');
/** The project's health in the header, next to its status. */
const healthBadge = (page: Page) =>
  page
    .locator('.facts > div')
    .filter({ has: page.getByText(health.label, { exact: true }) })
    .locator('.badge');

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
    await page.locator('#topic-title').fill(titles.market);
    await page.locator('#topic-description').fill('تحلیل بازار مشتریان');
    await page.getByRole('button', { name: topicText.createSubmit }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.created })).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: code }) });
    await expect(row).toContainText(titles.market);
    await expectNoSeriousA11yViolations(page);

    // Edit keeps the version history: the page sends If-Match with the loaded version.
    await row.getByRole('button', { name: topicText.edit }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: topicText.editTitle.replace('{code}', code) }),
    ).toBeFocused();
    await page.locator('#edit-title').fill(titles.marketEdited);
    await page.locator('#edit-reason').fill('اصلاح عنوان');
    await page.getByRole('button', { name: topicText.save }).click();
    await expect(page.getByRole('status').filter({ hasText: topicText.updatedDone })).toBeVisible();
    await expect(row).toContainText(titles.marketEdited);
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
      title: titles.first,
    });
    const second = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `pb-${stamp}`,
      title: titles.second,
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
    // The wizard: basics, then the prioritized topics.
    await page.getByRole('button', { name: wizardText.next }).click();
    const picker = page.locator('#project-add-topic');
    await picker.selectOption(first.topic.id);
    await page.getByRole('button', { name: projectText.addTopic }).click();
    await picker.selectOption(second.topic.id);
    await page.getByRole('button', { name: projectText.addTopic }).click();
    const order = page.locator('.priority-list > li');
    await expect(order).toHaveCount(2);
    await expect(order.first()).toContainText(titles.first);
    await page.getByRole('button', { name: `${projectText.moveDown}: ${titles.first}` }).click();
    await expect(order.first()).toContainText(titles.second);
    await expectNoSeriousA11yViolations(page);
    // Nothing is changed in the later steps, so the project inherits every value.
    for (let step = 2; step <= 7; step += 1) {
      await page.getByRole('button', { name: wizardText.next }).click();
    }
    await expect(page.getByRole('region', { name: wizardText.reviewTable })).toBeVisible();
    await page.getByRole('button', { name: wizardText.create }).click();

    await expect(page).toHaveURL(/\/fa\/projects\/[0-9a-f-]{36}$/u);
    await expect(
      page.getByRole('heading', { level: 2, name: new RegExp(code, 'u') }),
    ).toBeVisible();
    await expect(statusBadge(page)).toHaveText(detail.statuses['draft']!);
    await expect(healthBadge(page)).toHaveText(health.levels['idle']!);
    const milestone = page.getByRole('region', { name: health.milestone });
    await expect(milestone.getByText(health.milestoneNone)).toBeVisible();
    await expect(milestone.getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('button', { name: detail.commands['pause']! })).toHaveCount(0);
    const topicItems = page.locator('#topics-title').locator('xpath=following-sibling::ol/li');
    await expect(topicItems.first()).toContainText(titles.second); // saved in the chosen priority
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
    // A paused project is blocked until somebody resumes it.
    await expect(healthBadge(page)).toHaveText(health.levels['blocked']!);
    await page.getByRole('button', { name: detail.commands['resume']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    await expect(healthBadge(page)).not.toHaveText(health.levels['blocked']!);

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
      title: titles.flow,
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
    // The analyst asks first; the problem definition reaches the review once it is answered.
    await completeAnalysis(page);
    await page.getByRole('button', { name: detail.tabs.workflow, exact: true }).click();
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

    // The last approval completes the project: the overview shows the full milestone and the
    // header reads "done" without any reason to worry about.
    await page.getByRole('button', { name: detail.tabs.overview, exact: true }).click();
    const milestone = page.getByRole('region', { name: health.milestone });
    await expect(milestone.getByText(health.milestoneAll)).toBeVisible(waiting);
    await expect(
      milestone.getByRole('progressbar', { name: health.milestoneProgress }),
    ).toHaveJSProperty('value', 5);
    await expect(milestone.locator('.badge.state-completed')).toHaveCount(5);
    await expect(statusBadge(page)).toHaveText(detail.statuses['completed']!);
    await expect(healthBadge(page)).toHaveText(health.levels['done']!);
    await expect(page.getByRole('list', { name: health.label })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // The timeline records the decisions.
    await page.getByRole('button', { name: detail.tabs.timeline, exact: true }).click();
    await expect(page.getByRole('rowheader', { name: /workflow\.approve/u }).first()).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /workflow\.output_edited/u })).toBeVisible();

    // English view of the finished workflow.
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}\?tab=timeline$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Project' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('analysis: questions in batches, statuses, the later queue and the problem definition (ANL-001..006)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `an-${stamp}`,
      title: titles.analysis,
    });
    const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `anl-${stamp}`,
      title: 'تحلیل مسئله',
      initialProblem: 'فروش آنلاین کند شده و علت آن را نمی‌دانیم.',
      topics: [{ topicId: topic.topic.id }],
    });
    await page.goto(`/fa/projects/${created.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    await page.getByRole('button', { name: detail.tabs.problem, exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=problem/u);

    const wait = { timeout: 60_000 };
    const form = page.locator('form[aria-labelledby="batch-heading"]');
    const question = (n: number) => page.locator(`#batch-question-${n}`);
    const save = page.getByRole('button', { name: problemText.save, exact: true });
    const heading = page.locator('#batch-heading');
    const status = (text: string) => page.getByRole('status').filter({ hasText: text });

    // The first batch: twenty questions, the limits, the coverage and the analyst's reading.
    await expect(heading).toContainText(digits(1), wait);
    await expect(form.locator('.question')).toHaveCount(20);
    await expect(
      page.getByText(
        problemText.progressSummary
          .replace('{asked}', digits(20))
          .replace('{max}', digits(300))
          .replace('{answered}', digits(0))
          .replace('{min}', digits(30)),
      ),
    ).toBeVisible();
    await expect(
      page.locator('#coverage-heading').locator('xpath=..').locator('tbody tr'),
    ).toHaveCount(10);
    await expect(page.locator('#understanding-heading')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // "I answer" needs text or a file: nothing is saved and the problem is named.
    await question(1).getByRole('radio', { name: problemText.modes['answered']! }).check();
    await save.click();
    await expect(question(1).locator('.field-error')).toHaveText(problemText.needAnswer);
    await expectNoSeriousA11yViolations(page);

    // Three answers, one "later" and one "irrelevant" are saved; the batch stays open.
    await question(1).getByRole('textbox').fill('بودجهٔ ما ۵۰۰ میلیون تومان است');
    await question(2).getByRole('textbox').fill('تیم پنج‌نفره است');
    await question(3).getByRole('textbox').fill('مهلت تا پایان سه‌ماههٔ جاری است');
    await question(4).getByRole('radio', { name: problemText.modes['later']! }).check();
    await question(5).getByRole('radio', { name: problemText.modes['irrelevant']! }).check();
    await save.click();
    await expect(
      status(problemText.saved.partial.replace('{saved}', digits(5)).replace('{left}', digits(15))),
    ).toBeVisible();
    await expect(question(1)).toContainText(
      problemText.savedAs.replace('{mode}', problemText.modes['answered']!),
    );
    await expect(question(4)).toContainText(
      problemText.savedAs.replace('{mode}', problemText.modes['later']!),
    );

    // A saved answer can be changed while its batch is open.
    await question(1).getByRole('button', { name: problemText.editAnswer }).click();
    await question(1).getByRole('textbox').fill('بودجهٔ ما ۶۰۰ میلیون تومان است');
    await save.click();
    await expect(
      status(problemText.saved.partial.replace('{saved}', digits(1)).replace('{left}', digits(15))),
    ).toBeVisible();
    await expect(question(1)).toContainText('۶۰۰ میلیون');

    // The rest goes to the "later" queue in one click; the batch is then complete.
    await page.getByRole('button', { name: problemText.bulk.later }).click();
    await expect(page.getByText(problemText.allSet)).toBeVisible();
    await save.click();
    await expect(status(problemText.saved.complete)).toBeVisible();

    // The analyst reads the answers and asks the second batch: thirty questions are now asked.
    await expect(heading).toContainText(digits(2), wait);
    await expect(
      page.getByText(
        problemText.progressSummary
          .replace('{asked}', digits(40))
          .replace('{max}', digits(300))
          .replace('{answered}', digits(3))
          .replace('{min}', digits(30)),
      ),
    ).toBeVisible();
    await expect(page.getByText(problemText.minimumReached)).toBeVisible();

    // The "later" queue keeps sixteen questions; one of them is answered now.
    const queue = page.locator('#followups-heading').locator('xpath=..').locator('ol > li');
    await expect(queue).toHaveCount(16);
    await page
      .locator('#later-question-4')
      .getByRole('button', { name: problemText.editAnswer })
      .click();
    await page
      .locator('#later-question-4')
      .getByRole('textbox')
      .fill('گروه مالی مبلغ را تأیید کرد');
    await page
      .locator('#later-question-4')
      .getByRole('button', { name: problemText.saveOne })
      .click();
    await expect(status(problemText.saved.single)).toBeVisible();
    await expect(queue).toHaveCount(15);

    // Second batch: one answer, the rest irrelevant.
    await form.getByRole('textbox').first().fill('معیار موفقیت رشد ۲۰ درصدی فروش است');
    await page.getByRole('button', { name: problemText.bulk.irrelevant }).click();
    await save.click();
    await expect(status(problemText.saved.complete)).toBeVisible();

    // The problem definition: assumptions and unresolved points are set apart.
    const definitionHeading = page.locator('#definition-heading');
    await expect(definitionHeading).toBeVisible(wait);
    await expect(definitionHeading).toContainText(
      problemText.definitionStatuses['awaiting_approval']!,
    );
    await expect(page.locator('.highlight').first()).toBeVisible();
    await expect(
      page.locator('#unresolved-questions-heading').locator('xpath=..').locator('li'),
    ).toHaveCount(15);
    await expect(page.getByText(problemText.phases['awaiting_approval']!)).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // Rejecting with feedback sends the analysis back; version 2 arrives.
    await page.getByRole('button', { name: problemText.reject, exact: true }).click();
    await page.locator('#definition-feedback').fill('بودجه و مهلت را صریح‌تر بنویسید');
    await page.getByRole('button', { name: problemText.confirmReject }).click();
    await expect(status(problemText.done.rejected)).toBeVisible();
    await expect(definitionHeading).toContainText(
      problemText.versionLabel.replace('{n}', digits(2)),
      wait,
    );

    // Approval closes the analysis; the workflow goes on to research.
    await page.getByRole('button', { name: problemText.approve }).click();
    await expect(status(problemText.done.approved)).toBeVisible();
    await expect(definitionHeading).toContainText(
      problemText.definitionStatuses['approved']!,
      wait,
    );
    await expect(page.getByText(problemText.phases['approved']!)).toBeVisible();
    await page.getByRole('button', { name: detail.tabs.workflow, exact: true }).click();
    await expect(page.locator('.stage-list .badge.state-completed')).toHaveCount(1, wait);

    // The same tab in English keeps the section and the state.
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/projects\/[0-9a-f-]{36}\?tab=workflow$/u);
    await page
      .getByRole('button', { name: projectPageMessages('en').tabs.problem, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 3, name: problemMessages('en').title }),
    ).toBeVisible();
    await expect(page.getByText(problemMessages('en').phases['approved']!)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('analysis: a file answer goes straight to the object store and stays attached (ANL-003, ING-001)', async ({
    page,
  }) => {
    test.skip(!process.env['S3_ENDPOINT'], 'needs the object store (S3_ENDPOINT)');
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `fl-${stamp}`,
      title: `حوزهٔ فایل ${stamp}`,
    });
    const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `fil-${stamp}`,
      title: 'پاسخ فایلی',
      initialProblem: 'ریزش مشتریان را بررسی کنید.',
      topics: [{ topicId: topic.topic.id }],
    });
    await page.goto(`/fa/projects/${created.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(statusBadge(page)).toHaveText(detail.statuses['active']!);
    await page.getByRole('button', { name: detail.tabs.problem, exact: true }).click();
    await expect(page.locator('#batch-heading')).toBeVisible({ timeout: 60_000 });

    const first = page.locator('#batch-question-1');
    await first.locator('input[type="file"]').setInputFiles({
      name: 'survey.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ریزش مشتریان در سه‌ماههٔ گذشته ۱۴ درصد بود.'),
    });
    await expect(first.getByRole('listitem').filter({ hasText: 'survey.txt' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: problemText.save, exact: true }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: problemText.saved.partial
          .replace('{saved}', digits(1))
          .replace('{left}', digits(19)),
      }),
    ).toBeVisible();
    await expect(first).toContainText(`${problemText.attachmentLabel}: survey.txt`);

    // The record keeps the file as the answer to that question.
    const { workspaceId } = await apiSession(page);
    const listed = (await (
      await page.request.get(
        `/api/workspaces/${workspaceId}/projects/${created.project.id}/analysis/question-batches`,
      )
    ).json()) as {
      batches: {
        questions: { number: number; answer: { attachments: { title: string }[] } | null }[];
      }[];
    };
    const answer = listed.batches[0]!.questions.find((item) => item.number === 1)!.answer;
    expect(answer?.attachments.map((file) => file.title)).toEqual(['survey.txt']);

    // A type the pipeline does not accept is refused with a clear message and attaches nothing.
    const second = page.locator('#batch-question-2');
    await second.locator('input[type="file"]').setInputFiles({
      name: 'program.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    });
    await expect(failureNotice(page)).toBeVisible();
    await expect(second.getByRole('listitem').filter({ hasText: 'program.exe' })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('solutions and documents: generate, select, evaluate, accept an exception, approve, lock and reopen (SOL-001..003, DOC-101..102, EVA-001..002)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    // Level 1 accepts the short drafts of the offline provider, so the document is compliant.
    const { workspaceId, headers } = await apiSession(page);
    for (const [key, value] of [
      ['document.level', 1],
      [
        'document.level_bounds',
        [20, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
      ],
    ] as const) {
      const response = await page.request.put(
        `/api/workspaces/${workspaceId}/settings/assignments`,
        {
          headers,
          data: { key, scopeType: 'workspace', scopeId: workspaceId, value, reason: 'E2E setup' },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
    }
    const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `sd-${stamp}`,
      title: titles.solutions,
    });
    const created = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `sol-${stamp}`,
      title: 'راه‌حل و سند',
      initialProblem: 'کاهش ریزش مشتریان تکراری',
      topics: [{ topicId: topic.topic.id }],
    });

    // Solutions: generate three, tune the weights (must add up to 100), select two.
    await page.goto(`/fa/projects/${created.project.id}?tab=solutions`);
    await page.locator('#solution-count').fill('3');
    await page.getByRole('button', { name: solutionText.generate }).click();
    await expect(
      page.getByRole('status').filter({ hasText: solutionText.done.generated }),
    ).toBeVisible();
    const articles = page.locator('article');
    await expect(articles).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);

    const impact = page.getByLabel(`${solutionText.weight}: Impact on the problem`);
    const cost = page.getByLabel(`${solutionText.weight}: Cost and resources`);
    const save = page.getByRole('button', { name: solutionText.saveCriteria });
    await impact.fill('30');
    await expect(save).toBeDisabled(); // 105: the weights no longer add up to 100
    await cost.fill('10');
    await expect(save).toBeEnabled();
    await save.click(); // a reason is required: the browser stops the empty form
    await expect(page.locator('#criteria-reason:invalid')).toHaveCount(1);
    await page.locator('#criteria-reason').fill('اهمیت تأثیر بیشتر از هزینه است');
    await save.click();
    await expect(
      page.getByRole('status').filter({ hasText: solutionText.done.criteria }),
    ).toBeVisible();
    await expect(articles.first().getByText(solutionText.outOf)).toBeVisible();

    await articles.nth(0).getByRole('button', { name: solutionText.addToSelection }).click();
    await articles.nth(2).getByRole('button', { name: solutionText.addToSelection }).click();
    const selection = page.locator('.priority-list > li');
    await expect(selection).toHaveCount(2);
    await selection
      .nth(1)
      .getByRole('button', { name: new RegExp(solutionText.moveUp, 'u') })
      .click();
    await page.locator('#selection-reason').fill('دو گزینهٔ برتر');
    await page.getByRole('button', { name: solutionText.select }).click();
    await expect(
      page.getByRole('status').filter({ hasText: solutionText.done.selected }),
    ).toBeVisible();
    await expect(page.getByText(/انتخاب‌شده با اولویت/u)).toHaveCount(2);

    // Documents: one per selected solution, in priority order.
    await page.getByRole('button', { name: detail.tabs.documents, exact: true }).click();
    const rows = page.locator('#documents-title').locator('xpath=following-sibling::div//tbody/tr');
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole('button', { name: documentText.open }).click();
    await expect(page.locator('.document-view')).toContainText('خلاصه');
    const badge = page
      .locator('#document-heading')
      .locator('xpath=following-sibling::dl//dd/span')
      .first();
    await expect(badge).toHaveText(documentText.statuses['draft']!);
    await expectNoSeriousA11yViolations(page);

    // Approval is guarded: not before evaluation, not after a failed one.
    await page.getByRole('button', { name: documentText.submit }).click();
    await expect(badge).toHaveText(documentText.statuses['ready_for_review']!);
    await page.getByRole('button', { name: documentText.approve }).click();
    await expect(failureNotice(page)).toContainText(documentText.errors['DOCUMENT_NOT_EVALUATED']!);
    await page.getByRole('button', { name: documentText.evaluate }).click();
    await expect(
      page.getByRole('status').filter({ hasText: documentText.done['evaluate']! }),
    ).toBeVisible();
    await expect(
      page.locator('#evaluation-title').locator('xpath=following-sibling::p/span').first(),
    ).toHaveText(documentText.evaluationStatuses['failed_quality']!);
    await page.getByRole('button', { name: documentText.approve }).click();
    await expect(failureNotice(page)).toContainText(
      documentText.errors['DOCUMENT_EVALUATION_FAILED']!,
    );

    // An exception is visible everywhere and is never confused with a normal approval.
    await page.getByRole('button', { name: documentText.acceptException }).click();
    await page.locator('#document-reason').fill('مدیر عامل نتیجه را پذیرفت');
    await page.getByRole('button', { name: documentText.confirm, exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: documentText.done['exception']! }),
    ).toBeVisible();
    await page.getByRole('button', { name: documentText.approve }).click();
    await expect(badge).toHaveText(documentText.statuses['approved']!);
    await expect(
      page.getByText(documentText.approvalKinds['accepted_with_exception']!),
    ).toBeVisible();
    await expect(
      page.locator('.facts .badge', { hasText: documentText.exceptionBadge }),
    ).toBeVisible();

    // Lock, then reopen with a reason: that creates a new draft version.
    await page.getByRole('button', { name: documentText.lock }).click();
    await page.getByRole('button', { name: documentText.confirm, exact: true }).click();
    await expect(badge).toHaveText(documentText.statuses['locked']!);
    await expect(page.getByRole('button', { name: documentText.submit })).toHaveCount(0);
    await page.getByRole('button', { name: documentText.supersede }).click();
    await page.locator('#document-reason').fill('بازنگری فصلی');
    await page.getByRole('button', { name: documentText.confirm, exact: true }).click();
    await expect(badge).toHaveText(documentText.statuses['draft']!);

    // Versions: compare and restore the first one as a new version.
    const versionRows = page
      .locator('#versions-title')
      .locator('xpath=following-sibling::div//tbody/tr');
    await expect(versionRows).toHaveCount(2);
    await page.getByRole('button', { name: documentText.showDiff }).click();
    await expect(page.locator('.output-view')).toBeVisible();
    await versionRows.last().getByRole('button', { name: documentText.restore }).click();
    await page.locator('#document-reason').fill('بازگشت به متن اول');
    await page.getByRole('button', { name: documentText.confirm, exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: documentText.done['restore']! }),
    ).toBeVisible();
    await expect(versionRows).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);
  });

  test('a missing project says so instead of failing silently', async ({ page }) => {
    await signInWithKeyboard(page);
    await page.goto('/fa/projects/00000000-0000-4000-8000-000000000000');
    await expect(failureNotice(page)).toContainText(detail.notFound);
  });
});
