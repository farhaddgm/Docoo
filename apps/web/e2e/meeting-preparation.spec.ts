import { expect, test } from '@playwright/test';
import { emptyMeetingState, type MeetingState, type MeetingResponse } from '@docoo/contracts';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const base = `/api/workspaces/${workspaceId}/projects/${projectId}/meeting`;
interface Run {
  id: string;
  revision: number;
  mode: string;
  content: string;
  status: string;
  result: MeetingResponse;
}
for (const locale of ['fa', 'en'] as const) {
  test(`meeting preparation requires acceptance, supports real practice and reflection (${locale})`, async ({
    page,
  }) => {
    let revision = 0;
    let state = emptyMeetingState();
    const runs: Run[] = [];
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
            role: 'super_admin',
            id: '55555555-5555-4555-8555-555555555555',
            displayName: 'Admin',
          },
          workspaces: [{ id: workspaceId, name: 'Test', role: 'super_admin' }],
        });
      if (path === base && method === 'GET')
        return send({ revision, state, patternVersion: 1, runs, nextCursor: null });
      if (path === base && method === 'PUT') {
        const input = route.request().postDataJSON() as {
          expectedRevision: number;
          state: MeetingState;
        };
        expect(input.expectedRevision).toBe(revision);
        state = input.state;
        revision++;
        return send({ revision, state });
      }
      if (path === `${base}/messages`) {
        const input = route.request().postDataJSON() as {
          mode: 'prepare' | 'rehearse';
          content: string;
          expectedRevision: number;
          providerConsent: boolean;
        };
        expect(input.expectedRevision).toBe(revision);
        expect(input.providerConsent).toBe(true);
        const context = { ...state.context, goal: 'A clear salary request' };
        const result: MeetingResponse =
          input.mode === 'prepare'
            ? {
                answer: 'Let us clarify the outcome.',
                context,
                brief: {
                  goal: context.goal,
                  opening: 'I would like to discuss my role.',
                  points: ['My contribution', 'A fair adjustment', 'Next steps'],
                  hardPart: 'A budget objection',
                  response: 'Ask about a review timeline',
                  boundary: 'Respectful discussion',
                },
                perspectives: [{ kind: 'hypothesis', text: 'They may have a budget concern.' }],
                feedback: null,
              }
            : {
                answer: 'What change would you propose?',
                context: null,
                brief: null,
                perspectives: [],
                feedback: {
                  strength: 'Your topic was clear.',
                  improvement: 'Name a concrete request.',
                  retrySuggestion: 'Try proposing a specific outcome.',
                },
              };
        const item = {
          id: `66666666-6666-4666-8666-${String(runs.length + 1).padStart(12, '0')}`,
          revision,
          mode: input.mode,
          content: input.content,
          status: 'complete',
          result,
        };
        runs.push(item);
        return send(item);
      }
      return send({ items: [] });
    });
    await page.goto(`/${locale}/projects/${projectId}/meeting?workspaceId=${workspaceId}`);
    const describe = page.getByLabel(
      locale === 'fa' ? 'توضیح موقعیت یا پاسخ شما' : 'Describe the situation or answer a question',
    );
    await describe.fill('I want to discuss a salary increase with my manager.');
    const send = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال پیام' : 'Send message',
      exact: true,
    });
    await expect(send).toBeDisabled();
    const consent = page.getByLabel(locale === 'fa' ? 'اجازه می‌دهم' : 'I consent', {
      exact: false,
    });
    await consent.check();
    await send.click();
    await expect(page.getByText('Let us clarify the outcome.', { exact: true })).toBeVisible();
    const goal = page.getByRole('textbox', {
      name: locale === 'fa' ? 'هدف اصلی من' : 'My main goal',
      exact: true,
    });
    await expect(goal).toHaveValue('');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'بازبینی پیشنهاد در برگه' : 'Review suggestion in brief',
        exact: true,
      })
      .click();
    await expect(goal).toHaveValue('A clear salary request');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ذخیره برگه' : 'Save brief', exact: true })
      .click();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'شروع تمرین' : 'Start practice', exact: true })
      .click();
    await page
      .getByLabel(
        locale === 'fa' ? 'جمله‌ای که در جلسه می‌گویید' : 'What you would say in the meeting',
      )
      .fill('I want to discuss a salary adjustment.');
    await consent.check();
    await send.click();
    await expect(page.getByText('Name a concrete request.', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تلاش دوباره' : 'Try again', exact: true })
      .click();
    await expect(
      page.getByLabel(
        locale === 'fa' ? 'جمله‌ای که در جلسه می‌گویید' : 'What you would say in the meeting',
      ),
    ).toHaveValue('');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ادامه بدون تمرین' : 'Continue without practice',
        exact: true,
      })
      .click();
    await page
      .getByLabel(locale === 'fa' ? 'ملاقات برگزار شده است' : 'The meeting has happened', {
        exact: true,
      })
      .check();
    await page
      .getByLabel(locale === 'fa' ? 'چه شد؟' : 'What happened?', { exact: true })
      .fill('We agreed to a follow-up.');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'ذخیره مرور نتیجه' : 'Save reflection',
        exact: true,
      })
      .click();
    await expect.poll(() => state.reflection.outcome).toBe('We agreed to a follow-up.');
    expect(state.practice).toBe('skipped');
    expect(state.brief.goal).toBe('A clear salary request');
  });
}
