import { expect, test } from '@playwright/test';

import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { workflowMessages } from '../app/[locale]/projects/[projectId]/workflow-messages';
import {
  apiSession,
  completeAnalysis,
  createViaApi,
  expectNoSeriousA11yViolations,
  signInWithKeyboard,
  useFakeProvider,
} from './support';

const detail = projectPageMessages('fa');
const flow = workflowMessages('fa');
const stamp = Date.now().toString(36);

/**
 * An agent asks the administrator in the middle of a stage (ADR-0023). The ideator of this one
 * project may use `request_human_input`; the offline test model `fake-asks-human` asks once. The
 * stage waits, the question and why it matters are on the workflow tab, and the answer lets the
 * stage go on to its review.
 */
test.describe('an agent asks the administrator (TLC-007)', () => {
  test('the question waits on the workflow tab, the answer lets the stage go on', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const wait = { timeout: 60_000 };
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const { workspaceId, headers } = await apiSession(page);

    const area = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `aq-${stamp}`,
      title: `Agent question ${stamp}`,
    });
    const project = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `aq-${stamp}`,
      title: `Agent question project ${stamp}`,
      initialProblem: 'Reduce repeat-customer churn by 20%.',
      topics: [{ topicId: area.topic.id }],
    });
    const projectId = project.project.id;

    // Only this project: tool calling on, the model that asks, and an ideator that may ask.
    for (const [key, value] of [
      ['agents.tool_calling', true],
      ['ai.model', 'fake-asks-human'],
    ] as const) {
      const response = await page.request.put(
        `/api/workspaces/${workspaceId}/settings/assignments`,
        {
          headers,
          data: {
            key,
            scopeType: 'project',
            scopeId: projectId,
            value,
            reason: 'e2e agent question',
          },
        },
      );
      expect(response.status(), await response.text()).toBe(200);
    }
    const copied = await page.request.post(
      `/api/workspaces/${workspaceId}/projects/${projectId}/agents/ideator/copy-default`,
      { headers, data: { reason: 'e2e agent question' } },
    );
    expect(copied.status(), await copied.text()).toBeLessThan(300);
    const edited = await page.request.patch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/agents/ideator`,
      {
        headers,
        data: {
          changes: {
            tools: [
              'knowledge_retrieve',
              'project_documents_read',
              'calculator',
              'request_human_input',
            ],
          },
          reason: 'e2e agent question',
        },
      },
    );
    expect(edited.status(), await edited.text()).toBeLessThan(300);

    await page.goto(`/fa/projects/${projectId}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(page.locator('.facts .badge').first()).toHaveText(detail.statuses['active']!);
    await completeAnalysis(page);
    await page.getByRole('button', { name: detail.tabs.workflow, exact: true }).click();
    await expect(page.locator('#review-title-analysis')).toBeVisible(wait);
    await page.getByRole('button', { name: flow.approve }).click();
    await expect(page.locator('#review-title-research')).toBeVisible(wait);
    await page.getByRole('button', { name: flow.approve }).click();

    // The ideator asks: the stage stops, the question and its reason are shown, with a task.
    const title = page.getByRole('heading', {
      level: 2,
      name: flow.questionTitle.replace('{role}', flow.roles['ideator']!),
    });
    await expect(title).toBeVisible(wait);
    await expect(page.getByText('What is the budget ceiling?')).toBeVisible();
    await expect(page.getByText('To rank the solutions')).toBeVisible();
    await expect(page.getByText(flow.taskKinds['agent_question']!).first()).toBeVisible();
    await expect(page.locator('#review-title-ideation')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);

    // The answer lets the stage go on to its review; the exchange stays on the page.
    await page.getByLabel(flow.questionAnswer).fill('۵۰ هزار دلار');
    await page.getByRole('button', { name: flow.questionSend }).click();
    await expect(
      page.getByRole('status').filter({ hasText: flow.done.questionAnswered }),
    ).toBeVisible();
    await expect(page.locator('#review-title-ideation')).toBeVisible(wait);
    await expect(title).toHaveCount(0);
    const history = page.getByRole('heading', { level: 2, name: flow.questionHistory });
    await expect(history).toBeVisible();
    await expect(page.getByText('۵۰ هزار دلار')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
