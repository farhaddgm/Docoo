import { expect, test } from '@playwright/test';
import {
  meetingProblemPattern,
  type ProblemPatternDefinition,
  type PatternAiResponse,
} from '@docoo/contracts';

const workspaceId = '33333333-3333-4333-8333-333333333333';
const patternId = '44444444-4444-4444-8444-444444444444';
const base = `/api/workspaces/${workspaceId}/problem-patterns`;
interface Pattern {
  id: string;
  definition: ProblemPatternDefinition;
  revision: number;
  status: string;
}
interface Run {
  id: string;
  kind: string;
  revision: number;
  content: string;
  status: string;
  result: PatternAiResponse;
}

for (const locale of ['fa', 'en'] as const) {
  test(`pattern builder previews proposals and gates publishing (${locale})`, async ({ page }) => {
    let pattern: Pattern | null = null;
    const runs: Run[] = [];
    const versions: { id: string; version: number; revision: number }[] = [];
    let publishCount = 0;
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
            id: '55555555-5555-4555-8555-555555555555',
            role: 'super_admin',
            displayName: 'Admin',
            email: 'admin@example.test',
          },
          workspaces: [{ id: workspaceId, name: 'Test', role: 'super_admin' }],
        });
      if (path === base && method === 'GET')
        return send({
          patterns: pattern
            ? [
                {
                  ...pattern,
                  title: pattern.definition.title,
                  latest_version: versions.length || null,
                },
              ]
            : [],
        });
      if (path === base && method === 'POST') {
        const input = route.request().postDataJSON() as { definition: ProblemPatternDefinition };
        pattern = { id: patternId, definition: input.definition, revision: 1, status: 'draft' };
        return send(pattern);
      }
      if (path === `${base}/${patternId}` && method === 'GET')
        return send({ pattern, runs, versions });
      if (path === `${base}/${patternId}/draft` && method === 'PUT' && pattern) {
        const input = route.request().postDataJSON() as {
          definition: ProblemPatternDefinition;
          expectedRevision: number;
        };
        expect(input.expectedRevision).toBe(pattern.revision);
        pattern = { ...pattern, definition: input.definition, revision: pattern.revision + 1 };
        return send(pattern);
      }
      if (path === `${base}/${patternId}/messages` && pattern) {
        const input = route.request().postDataJSON() as {
          content: string;
          providerConsent: boolean;
        };
        expect(input.providerConsent).toBe(true);
        const item: Run = {
          id: '66666666-6666-4666-8666-666666666666',
          kind: 'chat',
          revision: pattern.revision,
          content: input.content,
          status: 'complete',
          result: {
            answer: 'A refined proposal',
            definition: { ...pattern.definition, purpose: 'A clearer preparation goal' },
            preview: null,
          },
        };
        runs.push(item);
        return send(item);
      }
      if (path === `${base}/${patternId}/tests` && pattern) {
        const input = route.request().postDataJSON() as {
          content: string;
          expectedRevision: number;
          providerConsent: boolean;
        };
        expect(input.expectedRevision).toBe(2);
        expect(input.providerConsent).toBe(true);
        const item: Run = {
          id: '77777777-7777-4777-8777-777777777777',
          kind: 'test',
          revision: pattern.revision,
          content: input.content,
          status: 'complete',
          result: {
            answer: 'Simulated preparation',
            definition: null,
            preview: {
              questions: ['What outcome do you want?'],
              researchDecision: 'No research needed.',
              sampleOutput: 'My preparation brief.',
              limitations: ['Simulation only.'],
            },
          },
        };
        runs.push(item);
        return send(item);
      }
      if (path === `${base}/${patternId}/versions` && pattern) {
        const input = route.request().postDataJSON() as {
          expectedRevision: number;
          testRunId: string;
        };
        expect(input.expectedRevision).toBe(2);
        expect(input.testRunId).toBe(runs[1]!.id);
        publishCount++;
        const version = {
          id: '88888888-8888-4888-8888-888888888888',
          version: 1,
          revision: pattern.revision,
        };
        versions.push(version);
        pattern.status = 'published';
        return send(version);
      }
      return send({ items: [] });
    });
    await page.goto(`/${locale}/workspaces/${workspaceId}/problem-patterns`);
    const sidebar = page.locator('#app-sidebar');
    const patternsLink = sidebar.getByRole('link', {
      name: locale === 'fa' ? 'الگوها' : 'Patterns',
      exact: true,
    });
    await expect(sidebar).toBeVisible();
    await expect(patternsLink).toHaveAttribute('aria-current', 'page');
    await expect(
      patternsLink.locator('xpath=ancestor::div[contains(@class,"nav-group")]'),
    ).toContainText(locale === 'fa' ? 'فضای کار' : 'Workspace');
    await patternsLink.click();
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);

    await page
      .getByText(locale === 'fa' ? 'ساخت دستی یا شروع از نمونه' : 'Manual creation or examples', {
        exact: true,
      })
      .click();
    await page
      .getByLabel(locale === 'fa' ? 'نقطهٔ شروع' : 'Starting point')
      .selectOption('meeting');
    await page
      .getByLabel(
        locale === 'fa' ? 'شناسهٔ الگو برای ساخت دستی' : 'Pattern identifier for manual creation',
      )
      .fill('meeting-test');
    await page
      .getByLabel(locale === 'fa' ? 'عنوان الگو' : 'Pattern title', { exact: true })
      .fill('Meeting test');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ساخت پیش‌نویس' : 'Create draft',
        exact: true,
      })
      .click();
    const publish = page.getByRole('button', {
      name: locale === 'fa' ? 'انتشار این ویرایش' : 'Publish this revision',
      exact: true,
    });
    await expect(publish).toBeDisabled();
    await page
      .getByLabel(
        locale === 'fa'
          ? 'پیام شما برای ساخت یا اصلاح الگو'
          : 'Your message to build or refine the pattern',
      )
      .fill('Make the goal clearer');
    const send = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال پیام' : 'Send message',
      exact: true,
    });
    await expect(send).toBeDisabled();
    await page.getByLabel(locale === 'fa' ? 'اجازه می‌دهم' : 'I consent', { exact: false }).check();
    await send.click();
    await expect(page.getByText('A refined proposal', { exact: true })).toBeVisible();
    expect(pattern!.definition.purpose).toBe(meetingProblemPattern.purpose);
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'پذیرش و ذخیرهٔ الگو' : 'Accept and save pattern',
        exact: true,
      })
      .click();
    await expect(publish).toBeDisabled();
    expect(pattern!.definition.purpose).toBe('A clearer preparation goal');
    await page
      .getByLabel(locale === 'fa' ? 'مسئلهٔ نمونه برای آزمایش' : 'Sample problem for preview', {
        exact: false,
      })
      .fill('A salary conversation with my manager');
    await page.getByLabel(locale === 'fa' ? 'اجازه می‌دهم' : 'I consent', { exact: false }).check();
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'آزمایش این ویرایش' : 'Preview this revision',
        exact: true,
      })
      .click();
    await expect(page.getByText('My preparation brief.', { exact: true })).toBeVisible();
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(publish).toBeDisabled();
    expect(publishCount).toBe(1);
    expect(versions[0]?.revision).toBe(2);
  });
}
