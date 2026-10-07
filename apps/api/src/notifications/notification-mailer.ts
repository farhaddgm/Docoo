import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import type { Environment } from '@docoo/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Pool } from 'pg';

import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';

export const NOTIFICATION_MAIL_TRANSPORT = Symbol('NOTIFICATION_MAIL_TRANSPORT');

/** What the mailer needs of a transport; nodemailer's satisfies it and tests replace it. */
export type MailTransport = Pick<Transporter, 'sendMail'>;

/** SMTP when the server has one (`SMTP_URL`), otherwise nothing is sent and mail is skipped. */
export const notificationTransportProvider: Provider = {
  provide: NOTIFICATION_MAIL_TRANSPORT,
  inject: [API_CONFIG],
  useFactory: (config: Environment): MailTransport | null =>
    config.SMTP_URL ? createTransport(config.SMTP_URL) : null,
};

/** Every kind of notification the mail may name, in the order the settings list them. */
export const MAIL_KINDS = [
  'gate_review',
  'analysis_answers',
  'agent_question',
  'attempt_limit',
  'provider_failure',
  'configuration',
  'cost_limit',
  'run_completed',
  'writing_succeeded',
  'writing_failed',
] as const;

const KIND_TEXT: Readonly<Record<string, { fa: string; en: string }>> = {
  gate_review: {
    fa: 'خروجی یک مرحله منتظر بازبینی شماست',
    en: 'A stage output waits for your review',
  },
  analysis_answers: {
    fa: 'پرسش‌های تحلیلگر منتظر پاسخ شماست',
    en: 'Analyst questions wait for your answers',
  },
  agent_question: { fa: 'یک ایجنت از شما سؤال پرسیده است', en: 'An agent asked you a question' },
  attempt_limit: { fa: 'سقف تلاش یک مرحله پر شده است', en: 'A stage reached its attempt limit' },
  provider_failure: {
    fa: 'ارائه‌دهندهٔ AI پاسخ نداد و پروژه متوقف شد',
    en: 'The AI provider failed and the project paused',
  },
  configuration: {
    fa: 'اتصال یا مدل AI تنظیم نشده و پروژه متوقف شد',
    en: 'No AI connection or model is set and the project paused',
  },
  cost_limit: {
    fa: 'سقف هزینهٔ پروژه رسید و پروژه متوقف شد',
    en: 'The project reached its cost limit and paused',
  },
  run_completed: { fa: 'اجرای پروژه کامل شد', en: 'A project run completed' },
  writing_succeeded: { fa: 'نگارش سند تمام شد', en: 'A document was written' },
  writing_failed: { fa: 'نگارش سند ناموفق بود', en: 'Writing a document failed' },
};

/** The most notifications one mail lists; the rest are in the page. */
const MAX_LISTED = 20;
const MAX_ATTEMPTS = 3;
/** A claim older than this was abandoned (a crash between claiming and sending). */
const CLAIM_TTL_MINUTES = 5;
const BATCH = 100;

interface Pending {
  id: string;
  kind: string;
  projectCode: string | null;
}

/**
 * The mail of notifications (ADR-0025). A mail names the kind of event and the project code, a
 * link to the page and nothing else: no project text leaves for a mail server. It is sent from an
 * outbox: the rows of `notifications` say what is pending, a tick claims some, sends one digest
 * per workspace and records the result. With mail off in the settings, or no SMTP on the server,
 * pending rows are marked skipped, so switching mail on later never sends a backlog.
 */
@Injectable()
export class NotificationMailer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NotificationMailer');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(API_CONFIG) private readonly environment: Environment,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(NOTIFICATION_MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    // Tests drive `dispatch()` themselves; a timer would race them.
    if (this.environment.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.dispatch().catch(() => undefined),
      this.environment.NOTIFICATION_MAIL_INTERVAL_SECONDS * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick over every workspace with pending mail; never throws, never overlaps itself. */
  async dispatch(): Promise<{ sent: number; skipped: number; failed: number }> {
    const totals = { sent: 0, skipped: 0, failed: 0 };
    if (this.running) return totals;
    this.running = true;
    try {
      const workspaces = (
        await this.pool.query<{ workspace_id: string }>(
          'select workspace_id from app.workspaces_with_pending_mail()',
        )
      ).rows;
      for (const { workspace_id: workspaceId } of workspaces) {
        try {
          const result = await this.dispatchWorkspace({
            workspaceId,
            actorId: '',
            correlationId: '',
          });
          totals.sent += result.sent;
          totals.skipped += result.skipped;
          totals.failed += result.failed;
        } catch (error) {
          this.logger.error(
            `Notification mail of a workspace failed (${error instanceof Error ? error.name : 'error'}).`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return totals;
  }

  private async dispatchWorkspace(context: WorkspaceRequestContext) {
    // 1. Decide what to do and claim the rows, in one short transaction.
    const claimed = await this.database.run(context, async (client) => {
      const effective = await this.config.resolve(
        client,
        context,
        'workspace',
        context.workspaceId,
      );
      const enabled = effective.values['notifications.email_enabled'] === true;
      const chosen = Array.isArray(effective.values['notifications.email_kinds'])
        ? (effective.values['notifications.email_kinds'] as unknown[]).filter(
            (kind): kind is string => typeof kind === 'string',
          )
        : [];
      const kinds = chosen.length > 0 ? chosen : [...MAIL_KINDS];
      const recipients = enabled
        ? (
            await client.query<{ email: string }>(
              `select u.email from memberships m join users u on u.id = m.user_id
                where m.role = 'super_admin' and u.status = 'active' order by u.email`,
            )
          ).rows.map((row) => row.email)
        : [];
      if (!enabled || !this.transport || recipients.length === 0) {
        const skipped = await client.query(
          `update notifications set email_status = 'skipped' where email_status = 'pending'`,
        );
        return { skipped: skipped.rowCount ?? 0, rows: [] as Pending[], recipients, kinds };
      }
      // A kind the administrator did not choose is skipped, never sent later.
      const unchosen = await client.query(
        `update notifications set email_status = 'skipped'
          where email_status = 'pending' and not (kind = any($1::text[]))`,
        [kinds],
      );
      const rows = (
        await client.query<{ id: string; kind: string; projectCode: string | null }>(
          `with picked as (
             select id from notifications
              where email_status = 'pending'
                and (email_claimed_at is null or email_claimed_at < now() - make_interval(mins => $1))
              order by created_at, id limit $2 for update skip locked)
           update notifications n set email_claimed_at = now()
             from picked
            where n.id = picked.id
            returning n.id, n.kind, (select code from projects p where p.id = n.project_id) as "projectCode"`,
          [CLAIM_TTL_MINUTES, BATCH],
        )
      ).rows;
      return { skipped: unchosen.rowCount ?? 0, rows, recipients, kinds };
    });
    if (claimed.rows.length === 0) return { sent: 0, skipped: claimed.skipped, failed: 0 };

    // 2. Send outside any transaction: a slow mail server holds no database connection.
    const mail = composeMail(claimed.rows, this.environment.WEB_ORIGIN);
    let delivered = false;
    try {
      for (const to of claimed.recipients) {
        await this.transport!.sendMail({ from: this.environment.MAIL_FROM, to, ...mail });
      }
      delivered = true;
    } catch (error) {
      this.logger.error(
        `Notification mail could not be sent (${error instanceof Error ? error.name : 'error'}).`,
      );
    }

    // 3. Record the result: sent, or one more attempt (and given up after the last).
    const ids = claimed.rows.map((row) => row.id);
    const failed = await this.database.run(context, async (client) => {
      if (delivered) {
        await client.query(
          `update notifications set email_status = 'sent', email_sent_at = now() where id = any($1::uuid[])`,
          [ids],
        );
        return 0;
      }
      const result = await client.query(
        `update notifications
            set email_attempts = email_attempts + 1,
                email_claimed_at = null,
                email_status = case when email_attempts + 1 >= $2 then 'failed' else 'pending' end
          where id = any($1::uuid[])`,
        [ids, MAX_ATTEMPTS],
      );
      return result.rowCount ?? 0;
    });
    return {
      sent: delivered ? ids.length : 0,
      skipped: claimed.skipped,
      failed: delivered ? 0 : failed,
    };
  }
}

/** The bilingual plain-text digest: kinds and project codes only, then the link. */
export function composeMail(
  rows: readonly Pending[],
  webOrigin: string,
): { subject: string; text: string } {
  const origin = webOrigin.replace(/\/$/u, '');
  const listed = rows.slice(0, MAX_LISTED);
  const line = (row: Pending, language: 'fa' | 'en') =>
    `- ${KIND_TEXT[row.kind]?.[language] ?? row.kind}${row.projectCode ? ` (${row.projectCode})` : ''}`;
  return {
    subject:
      rows.length === 1
        ? 'Docoo: یک مورد منتظر شماست / one item needs you'
        : `Docoo: ${rows.length} مورد منتظر شماست / ${rows.length} items need you`,
    text: [
      ...listed.map((row) => line(row, 'fa')),
      ...(rows.length > listed.length ? [`… (+${rows.length - listed.length})`] : []),
      '',
      ...listed.map((row) => line(row, 'en')),
      ...(rows.length > listed.length ? [`… (+${rows.length - listed.length})`] : []),
      '',
      `${origin}/fa/notifications`,
      `${origin}/en/notifications`,
    ].join('\n'),
  };
}
