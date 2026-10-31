import { expect, test } from '@playwright/test';

import { documentMessages } from '../app/[locale]/projects/[projectId]/document-messages';
import { editorMessages } from '../app/[locale]/projects/[projectId]/editor-messages';
import { problemMessages } from '../app/[locale]/projects/[projectId]/problem-messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { wizardMessages } from '../app/[locale]/projects/new/wizard-messages';
import { quickDraftMessages } from '../app/[locale]/projects/quick-draft-messages';
import {
  apiSession,
  completeAnalysis,
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
  fillReason,
} from './support';

test('an optional quick draft continues to full analysis with the original answers', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithKeyboard(page);
  await useFakeProvider(page);
  const stamp = Date.now().toString(36);
  const topic = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
    code: `qd-t-${stamp}`,
    title: `حوزهٔ پیش‌نویس سریع ${stamp}`,
  });
  await page.goto('/fa/projects/new');
  await page.locator('#project-code').fill(`qd-${stamp}`);
  await page.locator('#project-title').fill(`آزمون ادامهٔ پیش‌نویس ${stamp}`);
  await page.locator('#project-problem').fill('چگونه مشتریان تکراری را حفظ کنیم؟');
  const wizard = wizardMessages('fa');
  // The kind of analysis is chosen on the second step, with the business and the topics.
  await page.getByRole('button', { name: wizard.next }).click();
  await expect(page.locator('#analysis-profile')).toHaveValue('full');
  await page.locator('#analysis-profile').selectOption('quick');
  await expect(page.getByText(quickDraftMessages('fa').warning, { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.reload();
  await expect(page.locator('#analysis-profile')).toHaveValue('quick');
  await page.locator('#project-add-topic').selectOption(topic.topic.id);
  await page.getByRole('button', { name: 'افزودن حوزه', exact: true }).click();
  // The advanced settings keep their defaults; the second Next goes straight to the review.
  await page.getByRole('button', { name: wizard.next }).click();
  await page.getByRole('button', { name: wizard.continueDefaults }).click();
  await expect(page.getByText(quickDraftMessages('fa').quick, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: wizard.create }).click();
  await expect(page).toHaveURL(/\/fa\/projects\/[0-9a-f-]{36}$/u);
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  const { workspaceId, headers } = await apiSession(page);
  const base = `/api/workspaces/${workspaceId}/projects/${projectId}`;
  const read = async <T>(path: string): Promise<T> =>
    (await (await page.request.get(path)).json()) as T;
  type ProjectResponse = { project: { version: number; analysisProfile: string; status: string } };
  type Question = { id: string; number: number; answer: { attachments: unknown[] } | null };
  type BatchResponse = { batches: { questions: Question[] }[] };
  const project = (await read<ProjectResponse>(base)).project;
  expect(project.analysisProfile).toBe('quick');
  const activated = await page.request.post(`${base}/activate`, {
    headers,
    data: { expectedVersion: project.version },
  });
  expect(activated.ok(), await activated.text()).toBe(true);
  await page.reload();
  await page
    .getByRole('button', { name: projectPageMessages('fa').tabs.problem, exact: true })
    .click();
  await expect(page.locator('#batch-heading')).toBeVisible({ timeout: 60_000 });
  const firstQuestion = page.locator('#batch-question-1');
  await firstQuestion.locator('input[type="file"]').setInputFiles({
    name: 'quick-survey.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic anonymous survey attachment; no customer data.'),
  });
  await expect(
    firstQuestion.getByRole('listitem').filter({ hasText: 'quick-survey.txt' }),
  ).toBeVisible({ timeout: 30_000 });
  await completeAnalysis(page);
  const before = (await read<BatchResponse>(`${base}/analysis/question-batches`)).batches.flatMap(
    (b) => b.questions,
  );
  expect(before.length).toBeGreaterThanOrEqual(12);
  expect(before.length).toBeLessThanOrEqual(15);
  expect(before.some((q) => (q.answer?.attachments.length ?? 0) > 0)).toBe(true);
  for (const stage of ['analysis', 'research', 'ideation', 'documentation', 'evaluation']) {
    let ready:
      { id: string; status: string; stage: string; pendingGateOutputId: string } | undefined;
    await expect
      .poll(
        async () => {
          const flow = (
            await read<{ workflow: { stages: NonNullable<typeof ready>[] } }>(`${base}/workflow`)
          ).workflow;
          ready = flow.stages.find((s) => s.stage === stage);
          return ready?.status;
        },
        { timeout: 60_000 },
      )
      .toBe('waiting_for_human');
    const review = await page.request.post(
      `${base}/stages/${ready!.id}/outputs/${ready!.pendingGateOutputId}/approve`,
      {
        headers: { ...headers, 'idempotency-key': `qd-${stamp}-${stage}` },
        data: { comment: 'Automated offline acceptance fixture.' },
      },
    );
    expect(review.ok(), await review.text()).toBe(true);
  }
  await expect
    .poll(async () => (await read<ProjectResponse>(base)).project.status, {
      timeout: 60_000,
    })
    .toBe('completed');
  const generated = await createViaApi<{ solutionSet: { items: { id: string }[] } }>(
    page,
    `/projects/${projectId}/solutions/generate`,
    { count: 2 },
  );
  await createViaApi(page, `/projects/${projectId}/solution-selections`, {
    solutionIds: [generated.solutionSet.items[0]!.id],
    reason: 'Automated incomplete draft fixture.',
  });
  await page.goto(`/fa/projects/${projectId}?tab=documents`);
  await page
    .locator('#documents-title')
    .locator('xpath=following-sibling::div//tbody/tr')
    .first()
    .getByRole('button', { name: documentMessages('fa').open })
    .click();
  const writer = page.locator('section[aria-labelledby="writer-title"]');
  await expect(writer.locator('#writer-level option')).toHaveCount(1);
  await expect(writer.locator('#writer-level')).toHaveValue('1');
  await writer.getByRole('button', { name: editorMessages('fa').writeStart }).click();
  await expect(
    writer
      .locator('.badge')
      .filter({ hasText: editorMessages('fa').writingStatuses['succeeded']! })
      .first(),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.document-view')).toContainText(quickDraftMessages('fa').warning);
  await expectNoSeriousA11yViolations(page);
  await page.goto(`/en/projects/${projectId}`);
  await expect(page.getByText(quickDraftMessages('en').warning, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: quickDraftMessages('en').continue, exact: true }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.goto(`/fa/projects/${projectId}`);
  await page.getByRole('button', { name: quickDraftMessages('fa').continue, exact: true }).click();
  await expect(page.getByText(quickDraftMessages('fa').effect, { exact: true })).toBeVisible();
  await fillReason(page, page.locator('#command-reason'), 'ادامه با حفظ پاسخ‌های قبلی');
  await page.getByRole('button', { name: projectPageMessages('fa').confirm, exact: true }).click();
  await expect
    .poll(async () => (await read<ProjectResponse>(base)).project.analysisProfile)
    .toBe('full');
  await expect
    .poll(
      async () =>
        (await read<{ analysis: { limits: { minimum: number } } }>(`${base}/analysis`)).analysis
          .limits.minimum,
    )
    .toBe(30);
  const after = (await read<BatchResponse>(`${base}/analysis/question-batches`)).batches.flatMap(
    (b) => b.questions,
  );
  for (const question of before) expect(after.find((q) => q.id === question.id)).toEqual(question);
  await completeAnalysis(page);
  await page
    .locator('details > summary')
    .filter({ hasText: problemMessages('fa').versionsTitle })
    .click();
  await expect(
    page.locator('details[open] li').filter({ hasText: quickDraftMessages('fa').warning }),
  ).toBeVisible();
});
