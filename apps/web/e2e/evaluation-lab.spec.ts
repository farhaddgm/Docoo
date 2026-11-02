import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const reviewerId = '33333333-3333-4333-8333-333333333333';
const comparisonId = '44444444-4444-4444-8444-444444444444';
const connectionId = '55555555-5555-4555-8555-555555555555';
const definitionId = '66666666-6666-4666-8666-666666666666';
const base = `/api/workspaces/${workspaceId}/projects/${projectId}/evaluation-experiments`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hostileOutput = '<img src=x onerror="window.untrustedEvaluationOutput=true">';
const pack = {
  experimentId: 'browser-experiment',
  experimentHash: 'a'.repeat(64),
  rubricHash: 'b'.repeat(64),
  rubric: 'Review supplied evidence, units and citations. Score each output from 0 to 100.',
  cases: Array.from({ length: 6 }, (_, index) => ({
    caseId: `CASE-${index + 1}`,
    language: index % 2 === 0 ? 'fa' : 'en',
    input: `Synthetic input ${index + 1}`,
    expectedInvariantIds: ['cite_supplied_sources', 'preserve_units'],
    variants: (['A', 'B'] as const).map((label) => {
      const output =
        index === 0 && label === 'A'
          ? hostileOutput
          : `Reviewed evidence ${index + 1}, variant ${label}`;
      return { itemId: hash(`${index}-${label}`), label, output, outputHash: hash(output) };
    }),
  })),
};

function metric(caseCount: number) {
  return {
    caseCount,
    baselineMeanHumanScore: 80,
    candidateMeanHumanScore: 85,
    meanHumanScoreDelta: 5,
    regressedCaseCount: 0,
    improvedCaseCount: caseCount,
    unchangedCaseCount: 0,
    regressionRate: 0,
    baselineCitationErrors: 0,
    candidateCitationErrors: 0,
    citationErrorDelta: 0,
    baselineLatency: { measuredCaseCount: caseCount, meanMs: 120, p50Ms: 120, p95Ms: 150 },
    candidateLatency: { measuredCaseCount: caseCount, meanMs: 130, p50Ms: 130, p95Ms: 160 },
    cost: {
      baseline: {
        measuredCaseCount: 0,
        missingCaseCount: caseCount,
        knownCostUsd: null,
        completeCostUsd: null,
      },
      candidate: {
        measuredCaseCount: 0,
        missingCaseCount: caseCount,
        knownCostUsd: null,
        completeCostUsd: null,
      },
      candidateMinusBaselineUsd: null,
    },
    judgeHumanAgreement: {
      baseline: { reviewedCaseCount: 0, matchingCaseCount: 0, agreementRate: null },
      candidate: { reviewedCaseCount: 0, matchingCaseCount: 0, agreementRate: null },
    },
  };
}
function configuration(modelId: string) {
  return {
    role: 'researcher',
    provider: 'deterministic',
    modelId,
    modelSnapshotHash: hash(modelId),
    promptHash: hash(`prompt-${modelId}`),
    retrievalHash: 'c'.repeat(64),
    rubricHash: pack.rubricHash,
    pricingSnapshotHash: null,
  };
}
const report = {
  id: comparisonId,
  createdAt: '2026-10-16T13:00:00Z',
  reviewerId,
  comparison: {
    format: 'docoo-paired-evaluation-v1',
    dataset: { id: 'browser-corpus', version: 1, contentHash: 'd'.repeat(64) },
    baseline: { id: 'baseline-run', configuration: configuration('offline-baseline-v1') },
    candidate: { id: 'candidate-run', configuration: configuration('offline-candidate-v1') },
    metrics: { fa: metric(3), en: metric(3), all: metric(6) },
    cases: pack.cases.map((item) => ({
      caseId: item.caseId,
      language: item.language,
      baselineHumanScore: 80,
      candidateHumanScore: 85,
      humanScoreDelta: 5,
      baselineCitationErrors: 0,
      candidateCitationErrors: 0,
      citationErrorDelta: 0,
      regressed: false,
      improved: true,
    })),
    decision: null,
  },
};

async function fixture(
  page: Page,
  options: { readOnly?: boolean; failFirstSave?: boolean; failFirstStart?: boolean } = {},
) {
  const writes: string[] = [];
  const commandKeys: string[] = [];
  const startWrites: string[] = [];
  const startKeys: string[] = [];
  let saved = false;
  let startAttempts = 0;
  let denied = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/session') {
      return route.fulfill({
        status: 200,
        json: {
          user: {
            id: reviewerId,
            role: options.readOnly ? 'viewer' : 'super_admin',
            displayName: 'Reviewer',
          },
          workspaces: [
            {
              id: workspaceId,
              role: options.readOnly ? 'viewer' : 'super_admin',
              code: 'LAB',
              name: 'Lab',
            },
          ],
        },
      });
    }
    if (path === '/api/auth/access')
      return route.fulfill({ status: 200, json: { access: options.readOnly ? 'VIEW' : 'EDIT' } });
    if (path === `/api/workspaces/${workspaceId}/projects/${projectId}/agents/analyst`)
      return route.fulfill({
        status: 200,
        json: {
          definition: { id: definitionId, sequence: 1, reason: 'default', modelPolicy: null },
          defaultDefinition: {
            id: definitionId,
            sequence: 1,
            reason: 'default',
            modelPolicy: null,
          },
          ownVersions: [],
        },
      });
    if (path === `/api/workspaces/${workspaceId}/provider-connections`)
      return route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: connectionId,
              name: 'Test provider',
              status: 'active',
              secret: { configured: true },
            },
          ],
        },
      });
    if (path === `/api/workspaces/${workspaceId}/provider-connections/${connectionId}/models`)
      return route.fulfill({
        status: 200,
        json: {
          catalog: {
            models: ['live-model-a', 'live-model-b'].map((id) => ({
              id,
              displayName: id,
              capabilities: { text: true, structuredOutput: true },
            })),
          },
        },
      });
    if (path === base && request.method() === 'POST') {
      startAttempts += 1;
      startKeys.push(request.headers()['idempotency-key'] ?? '');
      startWrites.push(request.postData() ?? '');
      if (options.failFirstStart && startAttempts === 1)
        return route.fulfill({ status: 503, json: { code: 'UPSTREAM_UNAVAILABLE' } });
      return route.fulfill({
        status: 202,
        json: {
          experimentId: 'browser-started-experiment',
          status: 'queued',
          delivery: 'pending',
          replayed: startAttempts > 1,
        },
      });
    }
    if (path === base && request.method() === 'GET') {
      if (denied) return route.fulfill({ status: 403, json: { code: 'AUTH_PERMISSION_DENIED' } });
      return route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: pack.experimentId,
              status: 'completed',
              createdAt: '2026-10-16T12:00:00Z',
              datasetId: 'browser-corpus',
              datasetVersion: 1,
              synthetic: true,
              caseCount: 6,
              resultCount: 12,
              reviewCount: saved ? 1 : 0,
              role: 'researcher',
            },
          ],
          nextCursor: null,
        },
      });
    }
    if (path === `${base}/${pack.experimentId}/review-pack`)
      return route.fulfill({ status: 200, json: pack });
    if (path === `${base}/${pack.experimentId}/comparisons`)
      return route.fulfill({ status: 200, json: { items: saved ? [report] : [] } });
    if (path === `${base}/${pack.experimentId}/reviews` && request.method() === 'POST') {
      const key = request.headers()['idempotency-key'];
      if (!key)
        return route.fulfill({ status: 400, json: { code: 'EVALUATION_LAB_INVALID_REQUEST' } });
      commandKeys.push(key);
      writes.push(request.postData()!);
      saved = true;
      if (options.failFirstSave && writes.length === 1)
        return route.fulfill({ status: 503, json: { code: 'UPSTREAM_UNAVAILABLE' } });
      return route.fulfill({ status: 200, json: { id: comparisonId } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return {
    writes,
    commandKeys,
    startWrites,
    startKeys,
    revoke: () => {
      denied = true;
    },
  };
}

for (const locale of ['fa', 'en'] as const) {
  test(`starting a run retries the same bounded request (${locale})`, async ({ page }) => {
    const state = await fixture(page, { failFirstStart: true });
    await page.goto(`/${locale}/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`);
    const start = locale === 'fa' ? 'شروع آزمایش' : 'Start evaluation';
    const retry =
      locale === 'fa' ? 'تلاش دوباره برای ثبت همان آزمایش' : 'Retry the same evaluation request';
    await expect(
      page.getByText(
        locale === 'fa'
          ? 'این کار تا ۶۰ درخواست زنده'
          : 'This sends up to 60 live provider requests',
      ),
    ).toBeVisible();
    await page
      .getByLabel(locale === 'fa' ? 'مدل' : 'Model')
      .nth(1)
      .selectOption(`${connectionId}::live-model-b`);
    await page.getByRole('button', { name: start, exact: true }).click();
    await expect(page.getByRole('button', { name: retry, exact: true })).toBeVisible();
    await page.getByRole('button', { name: retry, exact: true }).click();
    await expect(page.getByText(locale === 'fa' ? 'در صف شروع' : 'queued for start')).toBeVisible();
    expect(state.startWrites).toHaveLength(2);
    expect(state.startWrites[1]).toBe(state.startWrites[0]);
    expect(state.startKeys[1]).toBe(state.startKeys[0]);
    expect(state.startKeys[0]).toMatch(/^web-[a-f0-9-]{36}$/);
    const sent = JSON.parse(state.startWrites[0]!) as Record<string, unknown>;
    expect(sent).toMatchObject({ role: 'analyst', repetition: 1, timeoutMs: 90_000 });
    expect(sent).not.toHaveProperty('dataset');
    expect(sent).not.toHaveProperty('prompt');
    expect(sent).not.toHaveProperty('apiKey');
  });
}

async function fillVisibleRatings(page: Page) {
  const scores = page.locator('input[id$="-score"]');
  const errors = page.locator('input[id$="-citationErrors"]');
  const accepts = page.locator('select[id$="-accepted"]');
  for (let index = 0; index < (await scores.count()); index++) {
    await scores.nth(index).fill('80');
    await errors.nth(index).fill('0');
    await accepts.nth(index).selectOption('yes');
  }
}

for (const locale of ['fa', 'en'] as const) {
  test(`blinded review, pagination, safe output rendering, retry and comparison (${locale})`, async ({
    page,
  }, testInfo) => {
    const state = await fixture(page, { failFirstSave: true });
    await page.goto(`/${locale}/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`);
    const review = locale === 'fa' ? 'بازبینی بدون نمایش مدل' : 'Review with model names hidden';
    const submit =
      locale === 'fa' ? 'ثبت بازبینی و محاسبه مقایسه' : 'Save review and calculate comparison';
    await page.getByRole('button', { name: review, exact: true }).click();
    await expect(page.getByText(hostileOutput, { exact: true })).toBeVisible();
    await expect(page.locator('.evaluation-lab-outputs img')).toHaveCount(0);
    await expect(page.getByText('offline-baseline-v1', { exact: false })).toHaveCount(0);
    if (locale === 'fa')
      await page.screenshot({ path: testInfo.outputPath('blinded-review-fa.png'), fullPage: true });
    await page.getByRole('button', { name: submit, exact: true }).click();
    await expect(page.locator('input[id$="-score"]').first()).toBeFocused();
    await fillVisibleRatings(page);
    await page.getByRole('button', { name: submit, exact: true }).click();
    // The first unrated case is on page two; validation navigates and focuses it.
    await expect(page.locator('input[id$="-score"]')).toHaveCount(2);
    await expect(page.locator('input[id$="-score"]').first()).toBeFocused();
    await fillVisibleRatings(page);
    await page.getByRole('button', { name: submit, exact: true }).click();
    await expect(page.locator('.evaluation-lab').getByRole('alert')).toContainText(
      locale === 'fa' ? 'بازبینی ثبت نشد' : 'review could not be saved',
    );
    await page.getByRole('button', { name: submit, exact: true }).click();
    await expect(page.locator('p.notice.success')).toContainText(
      locale === 'fa' ? 'بازبینی ذخیره شد' : 'review was saved',
    );
    expect(state.writes).toHaveLength(2);
    expect(state.writes[1]).toBe(state.writes[0]);
    expect(state.commandKeys).toHaveLength(2);
    expect(state.commandKeys[0]).toBe(state.commandKeys[1]);
    expect(state.commandKeys[0]).toMatch(/^[a-f0-9-]{36}$/);
    const sent = JSON.parse(state.writes[0]!) as { ratings: unknown[]; reviewedAt: string };
    expect(sent.ratings).toHaveLength(12);
    expect(sent).not.toHaveProperty('reviewerId');
    expect(sent.ratings[0]).not.toHaveProperty('judgeAccepted');
    expect(sent.ratings[0]).not.toHaveProperty('costUsd');
    await expect(page.getByText('deterministic / offline-baseline-v1')).toBeVisible();
    const costCell = page.locator('tbody tr').first().locator('td').nth(4);
    await expect(costCell).toContainText(locale === 'fa' ? 'نامعلوم' : 'Unknown');
    await expect(page.locator('tbody tr')).toHaveCount(3);
    if (locale === 'fa')
      await page.screenshot({ path: testInfo.outputPath('comparison-fa.png'), fullPage: true });
  });
}

test('view-only ratings stay disabled and a denied refresh clears previously visible output', async ({
  page,
}) => {
  const state = await fixture(page, { readOnly: true });
  await page.goto(`/en/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`);
  await page.getByRole('button', { name: 'Review with model names hidden', exact: true }).click();
  await expect(page.locator('input[id$="-score"]').first()).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save review and calculate comparison' }),
  ).toBeDisabled();
  state.revoke();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.evaluation-lab').getByRole('alert')).toContainText(
    'project is unavailable',
  );
  await expect(page.getByText(hostileOutput, { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('review controls remain usable on a narrow screen without page-wide horizontal overflow', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`);
  await page.getByRole('button', { name: 'Review with model names hidden', exact: true }).click();
  await expect(page.locator('input[id$="-score"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const columns = await page
    .locator('.evaluation-lab-outputs')
    .first()
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(1);
});
