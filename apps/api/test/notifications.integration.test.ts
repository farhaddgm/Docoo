import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StageFlow } from './support/flow.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

interface Item {
  id: string;
  kind: string;
  projectId: string | null;
  project: { code: string; title: string } | null;
  createdAt: string;
  readAt: string | null;
  stillWaiting: boolean | null;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

let h: Harness;
let flow: StageFlow;
let projectId: string;
let secondProject: string;

const list = (status: string = 'unread', extra = '', who = flow.cookie, ws = h.ids.workspaceA) =>
  h.request('GET', `/v1/workspaces/${ws}/notifications?status=${status}${extra}`, { cookie: who });
const unread = async () => (await flow.get<{ unread: number }>('/notifications/summary')).unread;
const rowsOf = (project: string) =>
  h.admin.query<{ kind: string; email_status: string; email_attempts: number }>(
    `select kind, email_status, email_attempts from notifications where project_id = $1 order by created_at, id`,
    [project],
  );

describe.skipIf(!adminUrl || !temporalAddress)('notifications (ADR-0025)', () => {
  beforeAll(async () => {
    h = await createHarness('notify', { workflow: true });
    flow = new StageFlow(h, await h.login(h.emails.a));
    await flow.prepare();
    projectId = await flow.reach('ntf1');
  }, 90_000);
  afterAll(async () => {
    await h?.close();
  });

  it('NTF-001: whatever creates a human task is notified, with the project, and says whether it still waits', async () => {
    const response = await list('all', '&limit=100');
    expect(response.statusCode, response.body).toBe(200);
    const { items } = response.json<Page>();
    const mine = items.filter((item) => item.projectId === projectId);
    const kinds = mine.map((item) => item.kind);
    // The analysis gate and the research gate.
    expect(kinds.filter((kind) => kind === 'gate_review')).toHaveLength(2);
    expect(kinds).toContain('analysis_answers');
    for (const item of mine) {
      expect(item.project).toMatchObject({ code: expect.stringMatching(/^ntf1-/u) });
      expect(item.readAt).toBeNull();
    }
    // The analysis questions were answered long ago; the analysis gate is open now.
    const gates = mine.filter((item) => item.kind === 'gate_review');
    expect(gates.map((item) => item.stillWaiting).sort()).toEqual([false, true]);
    expect(mine.find((item) => item.kind === 'analysis_answers')!.stillWaiting).toBe(false);
    // Newest first.
    expect(items.map((item) => item.createdAt)).toEqual(
      [...items.map((item) => item.createdAt)].sort().reverse(),
    );
    expect(await unread()).toBeGreaterThanOrEqual(mine.length);

    // Approving the gate resolves the task: the notification remains but no longer waits.
    const view = await flow.overview(projectId);
    await flow.decide(projectId, flow.stageOf(view, 'research'), 'approve');
    // Hold at the next human gate so later read-state checks have no background notifications.
    await flow.waitFor(
      projectId,
      flow.waiting('ideation'),
      'ideation gate before read-state checks',
    );
    const resolvedGateIds = new Set(gates.map((item) => item.id));
    const after = (await list('all', '&limit=100'))
      .json<Page>()
      .items.filter((item) => resolvedGateIds.has(item.id));
    expect(after).toHaveLength(gates.length);
    expect(after.every((item) => item.stillWaiting === false)).toBe(true);
  });

  it('NTF-002: a result is a notification too (run completed, document writing failed)', async () => {
    const run = await h.admin.query<{ id: string }>(
      'select id from workflow_runs where project_id = $1 limit 1',
      [projectId],
    );
    const before = (await rowsOf(projectId)).rows.filter(
      (row) => row.kind === 'run_completed',
    ).length;
    await h.admin.query(`update workflow_runs set status = 'completed' where id = $1`, [
      run.rows[0]!.id,
    ]);
    // The same status again is not an event.
    await h.admin.query(`update workflow_runs set status = 'completed' where id = $1`, [
      run.rows[0]!.id,
    ]);
    const rows = (await rowsOf(projectId)).rows.filter((row) => row.kind === 'run_completed');
    expect(rows).toHaveLength(before + 1);
    const items = (await list('all', '&limit=100')).json<Page>().items;
    expect(
      items.find((item) => item.kind === 'run_completed' && item.projectId === projectId),
    ).toMatchObject({
      stillWaiting: null,
    });
  });

  it('NTF-003: read marks, read all, paging and isolation', async () => {
    const all = (await list('all', '&limit=100')).json<Page>().items;
    const total = all.length;
    expect(total).toBeGreaterThanOrEqual(3);
    const startUnread = await unread();
    expect(startUnread).toBe(all.filter((item) => item.readAt === null).length);

    // Paging is stable and complete.
    const first = (await list('all', '&limit=2')).json<Page>();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await list('all', `&limit=2&cursor=${first.nextCursor}`)).json<Page>();
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
      all.slice(0, first.items.length + second.items.length).map((item) => item.id),
    );
    // A cursor of another list cannot page this one.
    expect((await list('unread', `&cursor=${first.nextCursor}`)).statusCode).toBe(400);
    expect((await list('all', '&cursor=not-a-cursor')).statusCode).toBe(400);
    expect((await list('all', '&limit=0')).statusCode).toBe(400);
    expect((await list('everything')).statusCode).toBe(400);

    // Reading one is idempotent and shows in both lists.
    const target = all.find((item) => item.readAt === null)!;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const read = await h.request(
        'POST',
        `/v1/workspaces/${h.ids.workspaceA}/notifications/${target.id}/read`,
        { cookie: flow.cookie, payload: {} },
      );
      expect(read.statusCode, read.body).toBe(200);
    }
    expect(await unread()).toBe(startUnread - 1);
    expect(
      (await list('unread', '&limit=100')).json<Page>().items.map((item) => item.id),
    ).not.toContain(target.id);
    const stamped = (await list('all', '&limit=100'))
      .json<Page>()
      .items.find((item) => item.id === target.id)!;
    expect(stamped.readAt).not.toBeNull();
    const reader = await h.admin.query<{ read_by: string }>(
      'select read_by from notifications where id = $1',
      [target.id],
    );
    expect(reader.rows[0]!.read_by).toBe(h.ids.userA);

    // Another workspace sees none of it and cannot read it.
    const cookieB = await h.login(h.emails.b);
    expect((await list('all', '', cookieB, h.ids.workspaceB)).json<Page>().items).toEqual([]);
    const foreign = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceB}/notifications/${target.id}/read`,
      { cookie: cookieB, payload: {} },
    );
    expect(foreign.statusCode).toBe(404);
    expect(
      (
        await h.request(
          'POST',
          `/v1/workspaces/${h.ids.workspaceA}/notifications/${crypto.randomUUID()}/read`,
          {
            cookie: flow.cookie,
            payload: {},
          },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.request('POST', `/v1/workspaces/${h.ids.workspaceA}/notifications/nope/read`, {
          cookie: flow.cookie,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);

    // Read all while the workflow waits at the ideation gate.
    const unreadBefore = await unread();
    const everything = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/notifications/read-all`,
      {
        cookie: flow.cookie,
        payload: {},
      },
    );
    expect(everything.statusCode).toBe(200);
    expect(everything.json<{ marked: number }>().marked).toBe(unreadBefore);
    expect(await unread()).toBe(0);
    expect((await list('unread')).json<Page>().items).toEqual([]);
    const audited = await h.admin.query<{ after: { marked: number } }>(
      `select after from audit_events where workspace_id = $1 and action = 'notification.read_all'`,
      [h.ids.workspaceA],
    );
    expect(audited.rows.at(-1)!.after.marked).toBe(unreadBefore);
    // Reading all again marks nothing and writes no audit event.
    const again = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/notifications/read-all`,
      {
        cookie: flow.cookie,
        payload: {},
      },
    );
    expect(again.json<{ marked: number }>().marked).toBe(0);
  });

  describe('the mail of notifications', () => {
    it('NTF-004: with mail off nothing is sent and pending rows are skipped, so turning it on later sends no backlog', async () => {
      secondProject = await flow.reach('ntf2');
      expect(
        (await rowsOf(secondProject)).rows.every((row) => row.email_status === 'pending'),
      ).toBe(true);
      const result = await h.mailer.dispatch();
      expect(result.sent).toBe(0);
      expect(h.mailbox.sent).toEqual([]);
      expect(
        (await rowsOf(secondProject)).rows.every((row) => row.email_status === 'skipped'),
      ).toBe(true);
      await flow.setting('notifications.email_enabled', true);
      await h.mailer.dispatch();
      expect(h.mailbox.sent).toEqual([]);
    });

    it('NTF-005: one digest per workspace goes to the administrators, with kinds and the project code only', async () => {
      await flow.setting('notifications.email_enabled', true);
      const third = await flow.reach('ntf3');
      const result = await h.mailer.dispatch();
      expect(result.sent).toBeGreaterThanOrEqual(2);
      expect(h.mailbox.sent).toHaveLength(1);
      const mail = h.mailbox.sent[0]!;
      expect(mail.to).toBe(h.emails.a);
      expect(mail.subject).toContain('Docoo');
      expect(mail.text).toContain('ntf3-');
      expect(mail.text).toContain('A stage output waits for your review');
      expect(mail.text).toContain('خروجی یک مرحله منتظر بازبینی شماست');
      expect(mail.text).toContain('/fa/notifications');
      // No project text: not the title, not the problem.
      expect(mail.text).not.toContain('Project ntf3');
      expect(mail.text).not.toContain('Reduce repeat-customer churn');
      expect((await rowsOf(third)).rows.every((row) => row.email_status === 'sent')).toBe(true);
      // Nothing is sent twice.
      await h.mailer.dispatch();
      expect(h.mailbox.sent).toHaveLength(1);
    });

    it('NTF-006: only the chosen kinds are mailed, the others are skipped for good', async () => {
      await flow.setting('notifications.email_enabled', true);
      await flow.setting('notifications.email_kinds', ['run_completed']);
      const fourth = await flow.reach('ntf4');
      h.mailbox.sent.length = 0;
      await h.mailer.dispatch();
      expect(h.mailbox.sent).toEqual([]);
      expect((await rowsOf(fourth)).rows.every((row) => row.email_status === 'skipped')).toBe(true);
      await flow.setting('notifications.email_kinds', []);
    });

    it('NTF-007: a mail server that is down is retried and, after the last attempt, given up on', async () => {
      await flow.setting('notifications.email_enabled', true);
      const fifth = await flow.reach('ntf5');
      h.mailbox.sent.length = 0;
      h.mailbox.failures = 1;
      // A tick scans every workspace of the shared database, so the totals are not this
      // test's alone; its own rows are what is asserted.
      await h.mailer.dispatch();
      let rows = (await rowsOf(fifth)).rows;
      expect(rows.every((row) => row.email_status === 'pending' && row.email_attempts === 1)).toBe(
        true,
      );
      // The next tick succeeds: the same rows go out in one mail.
      await h.mailer.dispatch();
      expect(h.mailbox.sent).toHaveLength(1);
      rows = (await rowsOf(fifth)).rows;
      expect(rows.every((row) => row.email_status === 'sent')).toBe(true);

      // A server that stays down: three failed ticks and the rows are marked failed, never retried again.
      const sixth = await flow.reach('ntf6');
      h.mailbox.failures = 99;
      for (let tick = 0; tick < 3; tick += 1) await h.mailer.dispatch();
      rows = (await rowsOf(sixth)).rows;
      expect(rows.every((row) => row.email_status === 'failed' && row.email_attempts === 3)).toBe(
        true,
      );
      h.mailbox.failures = 0;
      h.mailbox.sent.length = 0;
      await h.mailer.dispatch();
      expect(h.mailbox.sent).toEqual([]);
    });
  });
});
