import { test, expect } from '@playwright/test';
import { meetingProblemPattern, type ProblemPatternDefinition } from '@docoo/contracts';

const workspaceId = '33333333-3333-4333-8333-333333333333';
const patternId = '44444444-4444-4444-8444-444444444444';
const base = `/api/workspaces/${workspaceId}/problem-patterns`;
for (const locale of ['fa', 'en'] as const) {
  test(`starts from a conversation, generates editable identifiers and saves AI principles (${locale})`, async ({
    page,
  }) => {
    let created = 0;
    let messages = 0;
    let interrupted = false;
    let failed = false;
    let firstRequestId = '';
    let pattern: {
      id: string;
      revision: number;
      status: string;
      definition: ProblemPatternDefinition;
    } | null = null;
    const runs: unknown[] = [];
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      const send = (value: unknown) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(value),
        });
      if (path === '/api/auth/session')
        return send({
          user: {
            id: patternId,
            email: 'owner@example.test',
            displayName: 'Owner',
            role: 'super_admin',
            isOwner: true,
          },
          workspaces: [{ id: workspaceId, role: 'super_admin', name: 'Test' }],
        });
      if (path === base && method === 'GET')
        return send({
          patterns: pattern
            ? [{ ...pattern, title: pattern.definition.title, latest_version: null }]
            : [],
        });
      if (path === base && method === 'POST') {
        created++;
        pattern = {
          id: patternId,
          revision: 1,
          status: 'draft',
          definition: route.request().postDataJSON().definition,
        };
        return send(pattern);
      }
      if (path === `${base}/${patternId}`) return send({ pattern, runs, versions: [] });
      if (path === `${base}/${patternId}/messages` && pattern) {
        const input = route.request().postDataJSON();
        if (!interrupted) {
          interrupted = true;
          firstRequestId = input.idempotencyKey;
          return route.abort('failed');
        }
        if (!failed) {
          failed = true;
          expect(input.idempotencyKey).toBe(firstRequestId);
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'PATTERN_AI_FAILED' }),
          });
        }
        messages++;
        if (messages === 1) expect(input.idempotencyKey).not.toBe(firstRequestId);
        expect(input.providerConsent).toBe(true);
        const result = {
          id: crypto.randomUUID(),
          kind: 'chat',
          revision: pattern.revision,
          status: 'complete',
          content: input.content,
          error_code: null,
          result: {
            answer:
              messages === 1 ? 'Which principles matter most?' : 'Here is your reusable pattern.',
            preview: null,
            definition:
              messages === 1
                ? null
                : {
                    ...meetingProblemPattern,
                    key: 'ai-must-not-rename',
                    title: 'AI-created principles',
                    purpose: 'Prepare clearly without assuming motives',
                    boundaries: ['Distinguish facts from hypotheses'],
                  },
          },
        };
        runs.push(result);
        return send(result);
      }
      if (path === `${base}/${patternId}/draft` && pattern) {
        const input = route.request().postDataJSON();
        expect(input.expectedRevision).toBe(pattern.revision);
        pattern = { ...pattern, revision: pattern.revision + 1, definition: input.definition };
        return send(pattern);
      }
      return send({ items: [] });
    });
    await page.goto(`/${locale}/workspaces/${workspaceId}/problem-patterns`);
    const identifier = page.getByLabel(
      locale === 'fa' ? 'شناسهٔ پیشنهادی الگو' : 'Suggested pattern identifier',
    );
    await expect(identifier).toHaveValue(/^pattern-[0-9a-f-]{36}$/);
    const firstKey = await identifier.inputValue();
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'الگوی تازه با گفتگو' : 'New pattern conversation',
        exact: true,
      })
      .click();
    await expect(identifier).not.toHaveValue(firstKey);
    await identifier.fill('my-editable-pattern');
    await page
      .getByLabel(locale === 'fa' ? 'از الگو چه می‌خواهید؟' : 'What should this pattern do?')
      .fill(
        'Help prepare difficult conversations. Ask me what matters, then build reusable principles.',
      );
    const start = page.getByRole('button', {
      name: locale === 'fa' ? 'شروع گفتگو با AI' : 'Start conversation with AI',
      exact: true,
    });
    await expect(start).toBeDisabled();
    await page.getByLabel(locale === 'fa' ? 'اجازه می‌دهم' : 'I consent', { exact: false }).check();
    await start.click();
    await expect(page.locator('.patterns-page').getByRole('alert')).toBeVisible();
    expect(created).toBe(1);
    await expect(
      page.getByLabel(
        locale === 'fa'
          ? 'پیام شما برای ساخت یا اصلاح الگو'
          : 'Your message to build or refine the pattern',
      ),
    ).toHaveValue(
      'Help prepare difficult conversations. Ask me what matters, then build reusable principles.',
    );
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ارسال پیام' : 'Send message', exact: true })
      .click();
    await expect(page.locator('.patterns-page').getByRole('alert')).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ارسال پیام' : 'Send message', exact: true })
      .click();
    await expect(page.getByText('Which principles matter most?', { exact: true })).toBeVisible();
    expect(created).toBe(1);
    expect(pattern!.definition.key).toBe('my-editable-pattern');
    await page
      .getByLabel(
        locale === 'fa'
          ? 'پیام شما برای ساخت یا اصلاح الگو'
          : 'Your message to build or refine the pattern',
      )
      .fill('Keep facts separate from hypotheses; clarify goals and boundaries.');
    await page.getByLabel(locale === 'fa' ? 'اجازه می‌دهم' : 'I consent', { exact: false }).check();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ارسال پیام' : 'Send message', exact: true })
      .click();
    const accept = page.getByRole('button', {
      name: locale === 'fa' ? 'پذیرش و ذخیرهٔ الگو' : 'Accept and save pattern',
      exact: true,
    });
    await accept.click();
    await expect(
      page.getByRole('heading', { name: 'AI-created principles', exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('Distinguish facts from hypotheses', { exact: true }).last(),
    ).toBeVisible();
    expect(created).toBe(1);
    expect(messages).toBe(2);
    expect(pattern!.definition.key).toBe('my-editable-pattern');
    await page
      .getByText(locale === 'fa' ? 'ویرایش جزئیات الگو' : 'Edit pattern details', { exact: true })
      .click();
    await page
      .getByLabel(locale === 'fa' ? 'شناسهٔ الگو' : 'Pattern identifier', { exact: true })
      .fill('renamed-by-admin');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ذخیرهٔ تغییرات' : 'Save changes',
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel(locale === 'fa' ? 'شناسهٔ الگو' : 'Pattern identifier', { exact: true }),
    ).toHaveValue('renamed-by-admin');
    expect(pattern!.definition.key).toBe('renamed-by-admin');
    await expect(page.locator('#app-sidebar')).toBeVisible();
  });
}
