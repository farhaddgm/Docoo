import { expect, test } from '@playwright/test';

import { agentMessages } from '../app/[locale]/agents/agent-messages';
import { knowledgeMessages } from '../app/[locale]/knowledge/knowledge-messages';
import { projectPageMessages } from '../app/[locale]/projects/[projectId]/messages';
import { workflowMessages } from '../app/[locale]/projects/[projectId]/workflow-messages';
import { reportMessagesFor } from '../app/report-messages';
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
const knowledgeText = knowledgeMessages('fa');
const brainText = reportMessagesFor('fa').brain;
const brainEnglish = reportMessagesFor('en').brain;
const roles = agentMessages('fa').roles;
const stamp = Date.now().toString(36);
const topic = `zephyr${stamp}`;
const knowledgeTitle = `Support speed ${stamp}`;

/**
 * Research with approved knowledge and the Brain's model-based role evaluation in the browser
 * (ADR-0017): the research output says which findings approved knowledge supports and which
 * quotes were verified, the knowledge shows where it was used, and the Brain report judges the
 * roles against their charters with evidence. The stack runs the offline test provider.
 */
test.describe('knowledge-backed research and role evaluation (RSC-001, EVL-002)', () => {
  test('research cites approved knowledge, the knowledge shows its use, and Brain judges the roles', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const wait = { timeout: 60_000 };
    await signInWithKeyboard(page);
    await useFakeProvider(page);
    const { workspaceId, headers } = await apiSession(page);

    // Approved knowledge whose words match the project's problem.
    const knowledge = await createViaApi<{ knowledge: { id: string } }>(page, '/knowledge', {
      title: knowledgeTitle,
      sourceType: 'admin_provided',
      provenance: { declaration: 'Approved by the E2E committee' },
      scopes: [{ type: 'workspace', id: workspaceId }],
      content: `Churn of the ${topic} programme falls when support answers within one hour because customers who wait leave.`,
    });
    const knowledgeId = knowledge.knowledge.id;
    const audited = await page.request.post(
      `/api/workspaces/${workspaceId}/knowledge/${knowledgeId}/submit-audit`,
      { headers, data: {} },
    );
    expect(audited.status(), await audited.text()).toBe(200);

    const area = await createViaApi<{ topic: { id: string } }>(page, '/topics', {
      code: `rs-${stamp}`,
      title: `Research ${stamp}`,
    });
    const project = await createViaApi<{ project: { id: string } }>(page, '/projects', {
      code: `res-${stamp}`,
      title: `Research project ${stamp}`,
      initialProblem: `Reduce churn of the ${topic} programme`,
      topics: [{ topicId: area.topic.id }],
    });
    await page.goto(`/fa/projects/${project.project.id}`);
    await page.getByRole('button', { name: detail.commands['activate']! }).click();
    await expect(page.locator('.facts .badge').first()).toHaveText(detail.statuses['active']!);
    await completeAnalysis(page);
    await page.getByRole('button', { name: detail.tabs.workflow }).click();

    // Approve the problem definition; the researcher then gets the approved knowledge.
    const review = (stage: string) => page.locator(`#review-title-${stage}`);
    await expect(review('analysis')).toBeVisible(wait);
    await page.getByRole('button', { name: flow.approve }).click();
    await expect(page.getByRole('status').filter({ hasText: flow.done.approved })).toBeVisible();
    await expect(review('research')).toBeVisible(wait);

    // The research output tells supported findings from unverified ones, and why.
    const output = page.locator('.output-view').filter({ hasText: flow.out.knowledgeHeading });
    await expect(output).toBeVisible();
    await expect(output.getByText(flow.out.supportKnowledge, { exact: true })).toHaveCount(1);
    await expect(output.getByText(flow.out.supportUnverified, { exact: true })).toHaveCount(1);
    await expect(output.getByText(flow.out.citationVerified)).toHaveCount(1);
    await expect(output.locator('blockquote')).toHaveCount(1);
    await expect(
      output.getByText(
        flow.out.verificationSummary
          .replace('{findings}', '۲')
          .replace('{supported}', '۱')
          .replace('{unverified}', '۱')
          .replace('{verified}', '۱')
          .replace('{citations}', '۱'),
      ),
    ).toBeVisible();
    const link = output.getByRole('link', { name: knowledgeTitle }).first();
    await expect(link).toHaveAttribute('href', `/fa/knowledge/${knowledgeId}`);
    await expect(output.getByText(flow.out.cited, { exact: true })).toBeVisible();
    await expect(output.getByText(flow.out.restrictedExcluded)).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    // The knowledge page shows where it was used.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/fa/knowledge/${knowledgeId}$`, 'u'));
    const uses = page.getByRole('heading', { level: 2, name: knowledgeText.usesTitle });
    await expect(uses).toBeVisible(wait);
    const table = page.getByRole('region', { name: knowledgeText.usesCaption });
    await expect(table).toBeVisible();
    const row = table.locator('tbody tr').filter({ hasText: `Research project ${stamp}` });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByText(knowledgeText.usesCited)).toBeVisible();
    await expect(row.first().getByText(knowledgeText.usesStages['research']!)).toBeVisible();
    await expect(
      row.first().getByRole('link', { name: `Research project ${stamp}` }),
    ).toHaveAttribute('href', `/fa/projects/${project.project.id}`);
    await expectNoSeriousA11yViolations(page);

    // Brain judges the roles with the model: opt in, generate, read the evaluation.
    await page.goto('/fa/brain');
    await expect(page.getByRole('heading', { level: 1, name: brainText.title })).toBeVisible();
    await page.getByRole('checkbox', { name: brainText.modelEvaluationOption }).check();
    await page.getByRole('button', { name: brainText.generate }).click();
    const evaluations = page.getByRole('region', { name: brainText.evaluationsHeading });
    await expect(
      page.getByRole('heading', { level: 3, name: brainText.evaluationsHeading }),
    ).toBeVisible(wait);
    await expect(page.locator('#evaluations-title')).toBeVisible();
    for (const role of ['analyst', 'researcher'] as const) {
      const card = evaluations.locator('li.card').filter({
        has: page.getByRole('heading', { level: 4, name: new RegExp(roles[role].name, 'u') }),
      });
      await expect(card).toHaveCount(1);
      await expect(
        card.getByText(brainText.evalStatuses['completed']!, { exact: true }),
      ).toBeVisible();
      await expect(card.getByText('امتیاز: ۴ از ۵')).toBeVisible();
      // A strength and a deviation, each with charter clauses and the outputs that prove it.
      await expect(
        card.getByText(brainText.findingKinds['strength']!, { exact: true }),
      ).toBeVisible();
      await expect(
        card.getByText(brainText.findingKinds['deviation']!, { exact: true }),
      ).toBeVisible();
      await expect(card.getByText(brainText.findingClauses).first()).toBeVisible();
      await expect(card.getByText(brainText.findingEvidence).first()).toBeVisible();
      await expect(card.getByText(`${brainText.findingRecommendation}:`).first()).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);

    // The English page keeps the evaluation.
    await page.getByRole('link', { name: 'Switch to English' }).click();
    await expect(page).toHaveURL(/\/en\/brain/u);
    await expect(
      page.getByRole('heading', { level: 3, name: brainEnglish.evaluationsHeading }),
    ).toBeVisible(wait);
    await expect(page.getByText(brainEnglish.evalStatuses['completed']!).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
