import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  type CreateMonitorShareLinkInput,
  type MonitorKind,
  type MonitorShareInfo,
  type MonitorShareLinkCreated,
  type MonitorShareLinkSummary,
  type MonitorShareLook,
  type ViewerMonitorView,
  type VoiceMonitorView,
} from '@docoo/contracts';
import type { Environment } from '@docoo/config';
import type { Pool, PoolClient } from 'pg';

import { createSessionToken, digestSecret } from '../auth/auth.crypto.js';
import { writeAudit } from '../common/audit.js';
import { conflict, gone, notFound, tooManyRequests } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';
import { VoiceRateLimiter } from '../voice/voice-rate-limit.js';
import { MonitorService } from './monitor.service.js';

/** A watcher counts as present while its screen has asked for news within this many seconds. */
export const SHARE_PRESENCE_S = 45;
/** A watcher's session ends after this many hours, whatever happens. */
const SESSION_HOURS = 12;

interface LinkRow {
  id: string;
  workspace_id: string;
  kind: MonitorKind;
  password_hash: string;
  max_sessions: number;
  created_by: string;
  ended: boolean;
  expires_at: Date | null;
}

export interface SharedMonitorAnswer {
  readonly kind: MonitorKind;
  readonly look: MonitorShareLook;
  readonly view: ViewerMonitorView | VoiceMonitorView;
}

/**
 * Links that show one monitor to anyone with the address and the password. The address and each
 * watcher's session are kept only as digests, the password as an argon2 hash. A link answers
 * through the same projection as the owner's own window, so the monitor settings (what to hide,
 * the masking, the delay) apply to it unchanged. A visitor learns nothing before the password.
 */
@Injectable()
export class MonitorShareService {
  private readonly attempts = new VoiceRateLimiter(8, 5 * 60_000);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: Environment,
    private readonly database: WorkspaceDatabase,
    private readonly monitor: MonitorService,
  ) {}

  get secureCookies(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  private digest(value: string): string {
    return digestSecret(value, this.config.SESSION_PEPPER);
  }

  // ---- the owner ---------------------------------------------------------------------------

  async create(
    context: WorkspaceRequestContext,
    input: CreateMonitorShareLinkInput,
  ): Promise<MonitorShareLinkCreated> {
    const token = createSessionToken();
    const passwordHash = await hash(input.password, {
      memoryCost: this.config.PASSWORD_ARGON2_MEMORY_KIB,
      timeCost: this.config.PASSWORD_ARGON2_ITERATIONS,
      parallelism: this.config.PASSWORD_ARGON2_PARALLELISM,
    });
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ id: string; created_at: Date }>(
          `insert into monitor_share_links
             (workspace_id, kind, label, token_digest, password_hash, expires_at, max_sessions, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
          [
            context.workspaceId,
            input.kind,
            input.label,
            this.digest(token),
            passwordHash,
            input.expiresAt,
            input.maxSessions,
            context.actorId,
          ],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'monitor.share_created',
        targetType: 'monitor',
        targetId: row.id,
        after: {
          kind: input.kind,
          maxSessions: input.maxSessions,
          expires: input.expiresAt !== null,
        },
      });
      return {
        id: row.id,
        kind: input.kind,
        label: input.label,
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt).toISOString(),
        maxSessions: input.maxSessions,
        activeSessions: 0,
        createdAt: row.created_at.toISOString(),
        status: 'active' as const,
        token,
      };
    });
  }

  async list(context: WorkspaceRequestContext): Promise<MonitorShareLinkSummary[]> {
    return this.database.run(context, async (client) => {
      const rows = (
        await client.query<{
          id: string;
          kind: MonitorKind;
          label: string;
          expires_at: Date | null;
          max_sessions: number;
          created_at: Date;
          revoked_at: Date | null;
          expired: boolean;
          active: string;
        }>(
          `select l.id, l.kind, l.label, l.expires_at, l.max_sessions, l.created_at, l.revoked_at,
                  (l.expires_at is not null and l.expires_at <= now()) as expired,
                  (select count(*) from monitor_share_sessions s
                    where s.link_id = l.id
                      and s.last_seen_at > now() - make_interval(secs => $2)) as active
             from monitor_share_links l
            where l.workspace_id = $1
            order by l.created_at desc
            limit 100`,
          [context.workspaceId, SHARE_PRESENCE_S],
        )
      ).rows;
      return rows.map((row) => {
        const status: MonitorShareLinkSummary['status'] =
          row.revoked_at !== null ? 'revoked' : row.expired ? 'expired' : 'active';
        return {
          id: row.id,
          kind: row.kind,
          label: row.label,
          expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
          maxSessions: row.max_sessions,
          activeSessions: status === 'active' ? Number(row.active) : 0,
          createdAt: row.created_at.toISOString(),
          status,
        };
      });
    });
  }

  /** Ends a link at once: its watchers lose the screen on their next refresh. */
  async revoke(context: WorkspaceRequestContext, id: string): Promise<void> {
    await this.database.run(context, async (client) => {
      const done = await client.query(
        `update monitor_share_links set revoked_at = now()
          where id = $1 and workspace_id = $2 and revoked_at is null`,
        [id, context.workspaceId],
      );
      if (done.rowCount === 0) throw notFound('MONITOR_SHARE_NOT_FOUND', 'The link was not found.');
      await client.query(`delete from monitor_share_sessions where link_id = $1`, [id]);
      await writeAudit(client, context, {
        action: 'monitor.share_revoked',
        targetType: 'monitor',
        targetId: id,
        after: {},
      });
    });
  }

  // ---- the visitor -------------------------------------------------------------------------

  /** A link that exists and has not ended; anything else looks the same to the visitor. */
  private async usableLink(client: PoolClient, token: string, lock: boolean): Promise<LinkRow> {
    const row = (
      await client.query<LinkRow>(
        `select id, workspace_id, kind, password_hash, max_sessions, created_by, expires_at,
                (revoked_at is not null or (expires_at is not null and expires_at <= now())) as ended
           from monitor_share_links where token_digest = $1 ${lock ? 'for update' : ''}`,
        [this.digest(token)],
      )
    ).rows[0];
    if (!row) throw notFound('MONITOR_SHARE_NOT_FOUND', 'This link does not exist.');
    if (row.ended) throw gone('MONITOR_SHARE_ENDED', 'This link is no longer valid.');
    return row;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async presentCount(
    client: PoolClient,
    linkId: string,
    exceptDigest = '',
  ): Promise<number> {
    const row = (
      await client.query<{ n: string }>(
        `select count(*) as n from monitor_share_sessions
          where link_id = $1 and token_digest <> $3
            and last_seen_at > now() - make_interval(secs => $2)`,
        [linkId, SHARE_PRESENCE_S, exceptDigest],
      )
    ).rows[0]!;
    return Number(row.n);
  }

  async info(token: string): Promise<MonitorShareInfo> {
    const client = await this.pool.connect();
    try {
      const link = await this.usableLink(client, token, false);
      return { kind: link.kind };
    } finally {
      client.release();
    }
  }

  /** Checks the password and the room left, and starts a watcher's session. */
  async unlock(
    token: string,
    password: string,
    ip: string,
  ): Promise<{ sessionToken: string; maxAgeS: number }> {
    const wait = this.attempts.take(`${ip}|${this.digest(token)}`);
    if (wait > 0) {
      throw tooManyRequests(
        'MONITOR_SHARE_TOO_MANY_ATTEMPTS',
        'Too many attempts. Try again later.',
        Math.ceil(wait / 1000),
      );
    }
    const link = await this.transaction((client) => this.usableLink(client, token, false));
    if (!(await verify(link.password_hash, password))) {
      throw new UnauthorizedException({
        status: 401,
        title: 'Unauthorized',
        code: 'MONITOR_SHARE_WRONG_PASSWORD',
        detail: 'The password is not correct.',
      });
    }
    return this.transaction(async (client) => {
      // The link row is locked, so two visitors cannot both take the last place.
      const locked = await this.usableLink(client, token, true);
      if ((await this.presentCount(client, locked.id)) >= locked.max_sessions) {
        throw conflict('MONITOR_SHARE_FULL', 'The most screens allowed are already watching.');
      }
      await client.query(
        `delete from monitor_share_sessions
          where link_id = $1 and created_at < now() - make_interval(hours => $2)`,
        [locked.id, SESSION_HOURS],
      );
      const sessionToken = createSessionToken();
      await client.query(
        `insert into monitor_share_sessions (link_id, token_digest) values ($1, $2)`,
        [locked.id, this.digest(sessionToken)],
      );
      const untilEnd = locked.expires_at
        ? Math.floor((locked.expires_at.getTime() - Date.now()) / 1000)
        : Number.POSITIVE_INFINITY;
      return { sessionToken, maxAgeS: Math.max(1, Math.min(SESSION_HOURS * 3600, untilEnd)) };
    });
  }

  /** What the watcher's screen shows now; also the heartbeat that keeps its place. */
  async view(token: string, sessionToken: string | undefined): Promise<SharedMonitorAnswer> {
    const link = await this.transaction(async (client) => {
      const locked = await this.usableLink(client, token, true);
      const sessionDigest = sessionToken ? this.digest(sessionToken) : '';
      const session = (
        await client.query<{ created: boolean }>(
          `select created_at > now() - make_interval(hours => $3) as created
             from monitor_share_sessions where link_id = $1 and token_digest = $2`,
          [locked.id, sessionDigest, SESSION_HOURS],
        )
      ).rows[0];
      if (!session?.created) {
        throw new UnauthorizedException({
          status: 401,
          title: 'Unauthorized',
          code: 'MONITOR_SHARE_LOCKED',
          detail: 'Enter the password.',
        });
      }
      // A screen that was away may have lost its place to another one: it needs room again.
      if ((await this.presentCount(client, locked.id, sessionDigest)) >= locked.max_sessions) {
        throw conflict('MONITOR_SHARE_FULL', 'The most screens allowed are already watching.');
      }
      await client.query(
        `update monitor_share_sessions set last_seen_at = now() where token_digest = $1`,
        [sessionDigest],
      );
      return locked;
    });

    // The link acts as the owner who made it, read-only, so the usual row rules still apply.
    const context: WorkspaceRequestContext = {
      workspaceId: link.workspace_id,
      actorId: link.created_by,
      correlationId: crypto.randomUUID(),
    };
    const config = await this.monitor.clientConfig(context);
    const view =
      link.kind === 'viewer'
        ? await this.monitor.viewerView(context)
        : await this.monitor.voiceView(context);
    const s = config.settings;
    const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
      allowed.includes(value as T) ? (value as T) : fallback;
    const watermark = choice(s['monitor.watermark'], ['none', 'name', 'name_time'], 'name_time');
    // The name goes out only when the faint mark is to show it: what a setting hides is not sent.
    const name =
      watermark === 'none'
        ? ''
        : await this.database.run(
            context,
            async (client) =>
              (
                await client.query<{ name: string }>(`select name from workspaces where id = $1`, [
                  link.workspace_id,
                ])
              ).rows[0]?.name ?? '',
          );
    return {
      kind: link.kind,
      view,
      look: {
        theme: choice(s['monitor.theme'], ['dark', 'light', 'auto'], 'dark'),
        fontScale: typeof s['monitor.font_scale'] === 'number' ? s['monitor.font_scale'] : 1.5,
        language: choice(s['monitor.language'], ['ui', 'fa', 'en'], 'ui'),
        refreshS: typeof s['monitor.refresh_s'] === 'number' ? s['monitor.refresh_s'] : 3,
        liveBadge: s['monitor.live_badge'] !== false,
        watermark,
        workspaceName: name,
      },
    };
  }
}
