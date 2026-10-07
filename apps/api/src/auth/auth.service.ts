import { hash, verify } from '@node-rs/argon2';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isGmail, normalizeGmail, type AccountRole, type LoginMethod } from '@docoo/contracts';
import { GoogleAuthError, type GoogleIdentity } from './google-oauth.service.js';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Environment } from '@docoo/config';

import { createSessionToken, digestSecret } from './auth.crypto.js';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';

export interface AuthRequestMetadata {
  readonly correlationId: string;
  readonly origin?: string;
  readonly fetchSite?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface LoginResult {
  readonly token: string;
  readonly maxAgeSeconds: number;
  readonly user: AuthUser;
  readonly workspaces: readonly AuthWorkspace[];
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly loginMethod?: LoginMethod;
  readonly hasPassword?: boolean;
  readonly isOwner?: boolean;
  readonly lastLoginAt?: string | null;
}

export interface AuthWorkspace {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: AccountRole;
}

export interface IssuedSession {
  readonly token: string;
  readonly maxAgeSeconds: number;
}

type AuthEventAction =
  | 'login.failed'
  | 'login.succeeded'
  | 'logout.succeeded'
  | 'login.locked'
  | 'password.changed'
  | 'password.reset_requested'
  | 'password.reset_completed'
  | 'sessions.revoked';

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  status: 'active' | 'locked' | 'disabled';
  locked: boolean;
  account_role?: AccountRole;
  login_method?: LoginMethod;
  deleted_at?: Date | null;
  google_sub?: string | null;
  last_login_at?: Date | null;
}

interface WorkspaceRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  role: AccountRole;
}

interface SessionUserRow extends UserRow {
  id: string;
  email: string;
  display_name: string;
  status: 'active' | 'locked' | 'disabled';
  absolute_expires_at: Date;
  cookie_max_age_seconds: number;
}

interface AuthEventInput {
  readonly actorId: string | null;
  readonly action: AuthEventAction;
  readonly identifierDigest: string;
  readonly correlationId: string;
  readonly ipHash: string | null;
  readonly userAgentHash: string | null;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {
    this.dummyPasswordHash = hash('not-a-real-docoo-password', this.passwordHashOptions());
  }

  get secureCookies(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  async login(
    identifier: string,
    password: string,
    metadata: AuthRequestMetadata,
  ): Promise<LoginResult> {
    const identifierDigest = this.identifierDigest(identifier);
    const userResult = await this.pool.query<UserRow>(
      `select id, email, password_hash, display_name, status, account_role, login_method, deleted_at, google_sub, last_login_at,
              coalesce(locked_until > now(), false) as locked
         from users
        where lower(email) = lower($1)
        limit 1`,
      [identifier],
    );
    const user = userResult.rows[0];
    // Always verify a hash so unknown, locked and wrong-password attempts take similar time.
    const passwordMatches = await verify(
      user?.password_hash ?? (await this.dummyPasswordHash),
      password,
    );

    if (
      !user ||
      user.status !== 'active' ||
      user.locked ||
      user.deleted_at ||
      user.login_method === 'GOOGLE' ||
      !passwordMatches
    ) {
      if (user && user.status === 'active' && !user.locked && !passwordMatches) {
        await this.registerFailedAttempt(user.id, identifierDigest, metadata);
      }
      await this.recordAuthEvent({
        actorId: user?.id ?? null,
        action: 'login.failed',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
      throw this.invalidCredentials();
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const currentUserResult = await client.query<UserRow>(
        `select id, email, password_hash, display_name, status, account_role, login_method, deleted_at, google_sub, last_login_at,
                coalesce(locked_until > now(), false) as locked
           from users
          where id = $1
          for update`,
        [user.id],
      );
      const currentUser = currentUserResult.rows[0];
      if (
        !currentUser ||
        currentUser.status !== 'active' ||
        currentUser.locked ||
        currentUser.deleted_at ||
        currentUser.login_method === 'GOOGLE' ||
        currentUser.password_hash !== user.password_hash
      ) {
        await client.query('rollback');
        await this.recordAuthEvent({
          actorId: user.id,
          action: 'login.failed',
          identifierDigest,
          ...this.auditMetadata(metadata),
        });
        throw this.invalidCredentials();
      }

      const workspaces = await this.getUserWorkspaces(client, user.id);
      if (workspaces.length === 0) {
        await client.query('rollback');
        await this.recordAuthEvent({
          actorId: user.id,
          action: 'login.failed',
          identifierDigest,
          ...this.auditMetadata(metadata),
        });
        throw this.invalidCredentials();
      }

      await client.query(
        'update users set failed_login_count = 0, locked_until = null, last_login_at=now() where id = $1',
        [user.id],
      );
      const session = await this.issueSession(client, user.id, metadata);
      await this.insertAuthEvent(client, {
        actorId: user.id,
        action: 'login.succeeded',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
      await client.query('commit');

      return { ...session, user: this.toAuthUser(currentUser), workspaces };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async currentSession(token: string | undefined): Promise<{
    user: AuthUser;
    workspaces: readonly AuthWorkspace[];
    maxAgeSeconds: number;
  }> {
    if (!token) throw this.invalidSession();

    const result = await this.pool.query<SessionUserRow>(
      `with refreshed as (
         update sessions
            set last_seen_at = now(),
                idle_expires_at = least(
                  now() + ($2::integer * interval '1 second'),
                  absolute_expires_at
                )
          where token_digest = $1
            and revoked_at is null
            and idle_expires_at > now()
            and absolute_expires_at > now()
            and exists (
              select 1 from users active_user
               where active_user.id = sessions.user_id and active_user.status = 'active' and active_user.deleted_at IS NULL
            )
          returning user_id, absolute_expires_at,
                    least($2::integer, ceil(extract(epoch from absolute_expires_at - now()))::integer)
                      as cookie_max_age_seconds
       )
       select u.id, u.email, u.display_name, u.status, u.password_hash, u.account_role, u.login_method, u.last_login_at, r.absolute_expires_at,
              r.cookie_max_age_seconds
         from refreshed r
         join users u on u.id = r.user_id`,
      [this.tokenDigest(token), this.config.SESSION_IDLE_TTL_SECONDS],
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') throw this.invalidSession();

    const workspaceClient = await this.pool.connect();
    let workspaces: readonly AuthWorkspace[];
    try {
      await workspaceClient.query('begin');
      workspaces = await this.getUserWorkspaces(workspaceClient, user.id);
      await workspaceClient.query('commit');
    } catch (error) {
      await workspaceClient.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      workspaceClient.release();
    }
    if (workspaces.length === 0) throw this.invalidSession();

    return {
      user: this.toAuthUser(user),
      workspaces,
      maxAgeSeconds: user.cookie_max_age_seconds,
    };
  }

  async logout(token: string | undefined, metadata: AuthRequestMetadata): Promise<void> {
    if (!token) return;
    const digest = this.tokenDigest(token);
    await this.transaction(async (client) => {
      const result = await client.query<{ user_id: string } & QueryResultRow>(
        `update sessions
            set revoked_at = now()
          where token_digest = $1 and revoked_at is null
        returning user_id`,
        [digest],
      );
      const actorId = result.rows[0]?.user_id;
      if (actorId) {
        await this.insertAuthEvent(client, {
          actorId,
          action: 'logout.succeeded',
          identifierDigest: digest,
          ...this.auditMetadata(metadata),
        });
      }
    });
  }

  /** Revokes every session of the signed-in user, including the current one. */
  async revokeAllSessions(token: string | undefined, metadata: AuthRequestMetadata): Promise<void> {
    const session = await this.currentSession(token);
    await this.transaction(async (client) => {
      const revoked = await this.revokeUserSessions(client, session.user.id);
      await this.insertAuthEvent(client, {
        actorId: session.user.id,
        action: 'sessions.revoked',
        identifierDigest: this.identifierDigest(session.user.email),
        ...this.auditMetadata(metadata),
      });
      return revoked;
    });
  }

  /**
   * Changes the password after re-verifying the current one, revokes every session and
   * issues a fresh session so the caller stays signed in (session rotation).
   */
  async changePassword(
    token: string | undefined,
    currentPassword: string,
    newPassword: string,
    metadata: AuthRequestMetadata,
  ): Promise<IssuedSession> {
    const session = await this.currentSession(token);
    const identifierDigest = this.identifierDigest(session.user.email);
    const stored = await this.pool.query<{ password_hash: string } & QueryResultRow>(
      "select password_hash from users where id = $1 and login_method<>'GOOGLE' and deleted_at IS NULL and status='active'",
      [session.user.id],
    );
    const passwordHash = stored.rows[0]?.password_hash;
    if (!passwordHash || !(await verify(passwordHash, currentPassword))) {
      throw new BadRequestException({
        status: 400,
        title: 'Invalid request',
        code: 'AUTH_CURRENT_PASSWORD_INVALID',
        detail: 'The current password is incorrect.',
      });
    }
    this.assertPasswordPolicy(newPassword, session.user.email, currentPassword);
    const newHash = await hash(newPassword, this.passwordHashOptions());

    return this.transaction(async (client) => {
      const current = await client.query<UserRow>('select * from users where id=$1 for update', [
        session.user.id,
      ]);
      const account = current.rows[0];
      if (
        !account ||
        account.status !== 'active' ||
        account.deleted_at ||
        account.login_method === 'GOOGLE' ||
        account.password_hash !== passwordHash
      )
        throw this.invalidSession();
      await client.query(
        `update users
            set password_hash = $2, password_changed_at = now(),
                failed_login_count = 0, locked_until = null
          where id = $1`,
        [session.user.id, newHash],
      );
      await this.revokeUserSessions(client, session.user.id);
      const issued = await this.issueSession(client, session.user.id, metadata);
      for (const action of ['password.changed', 'sessions.revoked'] as const) {
        await this.insertAuthEvent(client, {
          actorId: session.user.id,
          action,
          identifierDigest,
          ...this.auditMetadata(metadata),
        });
      }
      return issued;
    });
  }

  /**
   * Creates a single-use reset token for an active user. The response never reveals
   * whether the account exists; the raw token only leaves through the delivery port.
   */
  async requestPasswordReset(
    identifier: string,
    metadata: AuthRequestMetadata,
  ): Promise<{ readonly email: string; readonly token: string } | null> {
    const identifierDigest = this.identifierDigest(identifier);
    const result = await this.pool.query<{ id: string; email: string } & QueryResultRow>(
      `select id, email from users where lower(email) = lower($1) and status = 'active' and login_method<>'GOOGLE' and deleted_at IS NULL limit 1`,
      [identifier],
    );
    const user = result.rows[0];
    const token = createSessionToken();

    await this.transaction(async (client) => {
      if (user) {
        // Only the newest token stays usable.
        await client.query(
          `update password_reset_tokens set consumed_at = now()
            where user_id = $1 and consumed_at is null`,
          [user.id],
        );
        await client.query(
          `insert into password_reset_tokens (user_id, token_digest, expires_at)
           values ($1, $2, now() + ($3::integer * interval '1 second'))`,
          [user.id, this.tokenDigest(token), this.config.PASSWORD_RESET_TTL_SECONDS],
        );
      }
      await this.insertAuthEvent(client, {
        actorId: user?.id ?? null,
        action: 'password.reset_requested',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
    });
    return user ? { email: user.email, token } : null;
  }

  /** Consumes a reset token exactly once, sets the password and revokes all sessions. */
  async resetPassword(
    token: string,
    newPassword: string,
    metadata: AuthRequestMetadata,
  ): Promise<void> {
    const digest = this.tokenDigest(token);
    const candidate = await this.pool.query<{ email: string } & QueryResultRow>(
      `select u.email
         from password_reset_tokens t
         join users u on u.id = t.user_id
        where t.token_digest = $1 and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
          and u.status = 'active' and u.login_method<>'GOOGLE' and u.deleted_at IS NULL`,
      [digest],
    );
    const email = candidate.rows[0]?.email;
    if (!email) throw this.invalidResetToken();
    this.assertPasswordPolicy(newPassword, email);
    const newHash = await hash(newPassword, this.passwordHashOptions());

    await this.transaction(async (client) => {
      const consumed = await client.query<{ user_id: string } & QueryResultRow>(
        `update password_reset_tokens t
            set consumed_at = now()
           from users u
          where t.token_digest = $1 and t.consumed_at is null and t.revoked_at is null and t.expires_at > now()
            and u.id = t.user_id and u.status = 'active' and u.login_method<>'GOOGLE' and u.deleted_at IS NULL
        returning t.user_id`,
        [digest],
      );
      const userId = consumed.rows[0]?.user_id;
      if (!userId) throw this.invalidResetToken();
      await client.query(
        `update users
            set password_hash = $2, password_changed_at = now(),
                failed_login_count = 0, locked_until = null
          where id = $1`,
        [userId, newHash],
      );
      await this.revokeUserSessions(client, userId);
      for (const action of ['password.reset_completed', 'sessions.revoked'] as const) {
        await this.insertAuthEvent(client, {
          actorId: userId,
          action,
          identifierDigest: this.identifierDigest(email),
          ...this.auditMetadata(metadata),
        });
      }
    });
  }

  isOwner(email: string): boolean {
    return normalizeGmail(email) === normalizeGmail(this.config.OWNER_EMAIL);
  }

  async loginWithGoogle(
    identity: GoogleIdentity,
    metadata: AuthRequestMetadata,
  ): Promise<LoginResult> {
    const client = await this.pool.connect();
    const identifierDigest = digestSecret(
      normalizeGmail(identity.email),
      this.config.SESSION_PEPPER,
    );
    try {
      await client.query('begin');
      if (!identity.emailVerified || identity.hostedDomain || !isGmail(identity.email))
        throw new GoogleAuthError('not_gmail');
      // Serialize aliases and first-owner provisioning across concurrent callbacks.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        normalizeGmail(identity.email),
      ]);
      const owner = this.isOwner(identity.email);
      let result = await client.query<UserRow>(
        `select * from users where deleted_at IS NULL AND (google_sub=$1 OR app.normalize_gmail(email)=$2) order by (google_sub=$1) desc nulls last, (login_method<>'PASSWORD') desc,created_at,id limit 1 for update`,
        [identity.sub, normalizeGmail(identity.email)],
      );
      let user = result.rows[0];
      if (user && normalizeGmail(user.email) !== normalizeGmail(identity.email))
        throw new GoogleAuthError('not_allowed');
      if (user?.google_sub && user.google_sub !== identity.sub)
        throw new GoogleAuthError('not_allowed');
      if (!user && owner) {
        result = await client.query<UserRow>(
          `insert into users(email,display_name,account_role,login_method,google_sub) values($1,$2,'super_admin','GOOGLE',$3) returning *`,
          [this.config.OWNER_EMAIL, identity.name?.trim() || 'Owner', identity.sub],
        );
        user = result.rows[0];
      }
      if (!user || (!owner && user.login_method === 'PASSWORD'))
        throw new GoogleAuthError('not_allowed');
      if (!owner && user.status !== 'active') throw new GoogleAuthError('inactive');
      await client.query(
        `update users set google_sub=$2,last_login_at=now(), status=CASE WHEN $3 THEN 'active'::user_status ELSE status END,account_role=CASE WHEN $3 THEN 'super_admin' ELSE account_role END where id=$1`,
        [user.id, identity.sub, owner],
      );
      if (owner) {
        await client.query("select set_config('app.actor_id',$1,true)", [user.id]);
        const catalog = await client.query<{ id: string }>(
          'select id from app.account_workspace_catalog()',
        );
        if (!catalog.rows.length) {
          const initialWorkspaceId = randomUUID();
          await client.query("select set_config('app.workspace_id',$1,true)", [initialWorkspaceId]);
          await client.query("insert into workspaces(id,code,name) values($1,'main','Docoo')", [
            initialWorkspaceId,
          ]);
          catalog.rows.push({ id: initialWorkspaceId });
        }
        for (const w of catalog.rows) {
          await client.query("select set_config('app.workspace_id',$1,true)", [w.id]);
          await client.query(
            "insert into memberships(workspace_id,user_id,role) values($1,$2,'super_admin') on conflict(workspace_id,user_id) do update set role='super_admin'",
            [w.id, user.id],
          );
        }
        user = { ...user, account_role: 'super_admin', status: 'active' };
      }
      const workspaces = await this.getUserWorkspaces(client, user.id);
      if (!workspaces.length) throw new GoogleAuthError('not_allowed');
      const token = createSessionToken();
      const maxAgeSeconds = Math.min(
        this.config.SESSION_IDLE_TTL_SECONDS,
        this.config.SESSION_ABSOLUTE_TTL_SECONDS,
      );
      await client.query(
        `insert into sessions(user_id,token_digest,idle_expires_at,absolute_expires_at,ip_hash,user_agent_hash) values($1,$2,now()+($3::integer*interval '1 second'),now()+($4::integer*interval '1 second'),$5,$6)`,
        [
          user.id,
          digestSecret(token, this.config.SESSION_PEPPER),
          this.config.SESSION_IDLE_TTL_SECONDS,
          this.config.SESSION_ABSOLUTE_TTL_SECONDS,
          this.digestOptional(metadata.ip),
          this.digestOptional(metadata.userAgent),
        ],
      );
      await this.insertAuthEvent(client, {
        actorId: user.id,
        action: 'login.succeeded',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
      await client.query(
        `insert into account_events(actor_id,target_id,action,details) values($1,$1,'auth.google.login','{}')`,
        [user.id],
      );
      await client.query('commit');
      return { token, maxAgeSeconds, user: this.toAuthUser(user), workspaces };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      await this.recordAuthEvent({
        actorId: null,
        action: 'login.failed',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async resourceAccess(
    workspaceId: string,
    actorId: string,
    params: Record<string, unknown>,
  ): Promise<'VIEW' | 'EDIT' | null> {
    return this.transaction(async (client) => {
      await client.query(
        "select set_config('app.workspace_id',$1,true),set_config('app.actor_id',$2,true)",
        [workspaceId, actorId],
      );
      if (typeof params['knowledgeId'] === 'string') {
        if (!this.isUuid(params['knowledgeId']))
          throw new BadRequestException('Invalid resource ID');
        const result = await client.query<{ access: 'VIEW' | 'EDIT' | null }>(
          'select app.knowledge_access($1,$2) as access',
          [workspaceId, params['knowledgeId']],
        );
        return result.rows[0]?.access ?? null;
      }
      let kind = 'project';
      let id = params['projectId'];
      if (typeof params['topicId'] === 'string') {
        kind = 'topic';
        id = params['topicId'];
      }
      if (typeof id !== 'string' && typeof params['sourceId'] === 'string') {
        const result = await client.query<{ scope_type: string; scope_id: string }>(
          'select scope_type,scope_id from source_assets where workspace_id=$1 and id=$2',
          [workspaceId, params['sourceId']],
        );
        const source = result.rows[0];
        if (source && ['project', 'topic'].includes(source.scope_type)) {
          kind = source.scope_type;
          id = source.scope_id;
        }
      }
      const lookups: Record<string, string> = {
        runId: 'select project_id from workflow_runs where workspace_id=$1 and id=$2',
        batchId: 'select project_id from question_batches where workspace_id=$1 and id=$2',
        documentId: 'select project_id from documents where workspace_id=$1 and id=$2',
        solutionId: 'select project_id from solutions where workspace_id=$1 and id=$2',
        sourceId:
          "select scope_id as project_id from source_assets where workspace_id=$1 and id=$2 and scope_type='project'",
        evaluationId:
          'select d.project_id from evaluations e join documents d on d.id=e.document_id where e.workspace_id=$1 and e.id=$2',
        findingId:
          'select d.project_id from evaluation_findings f join evaluations e on e.id=f.evaluation_id join documents d on d.id=e.document_id where f.workspace_id=$1 and f.id=$2',
      };
      if (typeof id !== 'string')
        for (const [key, sql] of Object.entries(lookups)) {
          const value = params[key];
          if (typeof value !== 'string') continue;
          if (!this.isUuid(value)) throw new BadRequestException('Invalid resource ID');
          const result = await client.query<{ project_id: string }>(sql, [workspaceId, value]);
          id = result.rows[0]?.project_id;
          break;
        }
      if (typeof id !== 'string') return null;
      if (!this.isUuid(id)) throw new BadRequestException('Invalid resource ID');
      const result = await client.query<{ access: 'VIEW' | 'EDIT' | null }>(
        'select app.resource_access($1,$2,$3) as access',
        [kind, workspaceId, id],
      );
      return result.rows[0]?.access ?? null;
    });
  }

  assertSameOrigin(metadata: AuthRequestMetadata): void {
    if (metadata.origin !== this.config.WEB_ORIGIN || metadata.fetchSite === 'cross-site') {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_CROSS_ORIGIN_REQUEST',
        detail: 'The request origin is not allowed.',
      });
    }
  }

  assertPasswordPolicy(password: string, email: string, previousPassword?: string): void {
    const tooShort = [...password].length < PASSWORD_MIN_LENGTH;
    const tooLong = password.length > 128;
    const sameAsEmail = password.trim().toLowerCase() === email.trim().toLowerCase();
    const unchanged = previousPassword !== undefined && password === previousPassword;
    if (tooShort || tooLong || sameAsEmail || unchanged) {
      throw new BadRequestException({
        status: 400,
        title: 'Invalid request',
        code: 'AUTH_PASSWORD_POLICY',
        detail: `Use a new password of at least ${PASSWORD_MIN_LENGTH} characters that is not your email address.`,
      });
    }
  }

  private async registerFailedAttempt(
    userId: string,
    identifierDigest: string,
    metadata: AuthRequestMetadata,
  ): Promise<void> {
    const threshold = this.config.AUTH_LOCKOUT_THRESHOLD;
    // Progressive lockout: each further block of `threshold` failures doubles the lock.
    const result = await this.pool.query<{ locked_now: boolean } & QueryResultRow>(
      `update users
          set failed_login_count = failed_login_count + 1,
              locked_until = case
                when failed_login_count + 1 >= $2 then now() + make_interval(secs => least(
                  $4::double precision,
                  $3::double precision * power(2, floor((failed_login_count + 1 - $2) / $2::numeric))
                ))
                else locked_until
              end
        where id = $1 and status = 'active'
      returning failed_login_count >= $2 as locked_now`,
      [
        userId,
        threshold,
        this.config.AUTH_LOCKOUT_BASE_SECONDS,
        this.config.AUTH_LOCKOUT_MAX_SECONDS,
      ],
    );
    if (result.rows[0]?.locked_now) {
      await this.recordAuthEvent({
        actorId: userId,
        action: 'login.locked',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
    }
  }

  private async issueSession(
    client: PoolClient,
    userId: string,
    metadata: AuthRequestMetadata,
  ): Promise<IssuedSession> {
    const token = createSessionToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + this.config.SESSION_IDLE_TTL_SECONDS * 1000);
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    );
    await client.query(
      `insert into sessions (
         user_id, token_digest, last_seen_at, idle_expires_at, absolute_expires_at,
         ip_hash, user_agent_hash
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        this.tokenDigest(token),
        now,
        idleExpiresAt,
        absoluteExpiresAt,
        this.digestOptional(metadata.ip),
        this.digestOptional(metadata.userAgent),
      ],
    );
    return {
      token,
      maxAgeSeconds: Math.min(
        this.config.SESSION_IDLE_TTL_SECONDS,
        this.config.SESSION_ABSOLUTE_TTL_SECONDS,
      ),
    };
  }

  private async revokeUserSessions(client: PoolClient, userId: string): Promise<number> {
    const result = await client.query(
      'update sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
      [userId],
    );
    return result.rowCount ?? 0;
  }

  private async getUserWorkspaces(
    connection: PoolClient,
    userId: string,
  ): Promise<readonly AuthWorkspace[]> {
    await connection.query("select set_config('app.actor_id', $1, true)", [userId]);
    const result = await connection.query<WorkspaceRow>(
      `select id, code, name, role
         from app.auth_user_workspaces()
        order by code, id`,
    );
    return result.rows.map((workspace) => ({
      id: workspace.id,
      code: workspace.code,
      name: workspace.name,
      role: workspace.role,
    }));
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordAuthEvent(input: AuthEventInput): Promise<void> {
    await this.insertAuthEvent(this.pool, input);
  }

  private async insertAuthEvent(
    connection: Pool | PoolClient,
    input: AuthEventInput,
  ): Promise<void> {
    await connection.query(
      `insert into auth_events (
         actor_id, action, identifier_digest, correlation_id, ip_hash, user_agent_hash
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorId,
        input.action,
        input.identifierDigest,
        input.correlationId,
        input.ipHash,
        input.userAgentHash,
      ],
    );
  }

  private auditMetadata(
    metadata: AuthRequestMetadata,
  ): Pick<AuthEventInput, 'correlationId' | 'ipHash' | 'userAgentHash'> {
    return {
      correlationId: this.isUuid(metadata.correlationId) ? metadata.correlationId : randomUUID(),
      ipHash: this.digestOptional(metadata.ip),
      userAgentHash: this.digestOptional(metadata.userAgent),
    };
  }

  private identifierDigest(identifier: string): string {
    return digestSecret(identifier.toLowerCase(), this.config.SESSION_PEPPER);
  }

  private tokenDigest(token: string): string {
    return digestSecret(token, this.config.SESSION_PEPPER);
  }

  private digestOptional(value: string | undefined): string | null {
    return value ? digestSecret(value, this.config.SESSION_PEPPER) : null;
  }

  private passwordHashOptions() {
    return {
      memoryCost: this.config.PASSWORD_ARGON2_MEMORY_KIB,
      timeCost: this.config.PASSWORD_ARGON2_ITERATIONS,
      parallelism: this.config.PASSWORD_ARGON2_PARALLELISM,
    };
  }

  private toAuthUser(user: UserRow): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.account_role ?? 'super_admin',
      loginMethod: user.login_method ?? 'PASSWORD',
      hasPassword: !!user.password_hash,
      isOwner: this.isOwner(user.email),
      lastLoginAt: user.last_login_at?.toISOString() ?? null,
    };
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      status: 401,
      title: 'Unauthorized',
      code: 'AUTH_INVALID_CREDENTIALS',
      detail: 'The identifier or password is incorrect.',
    });
  }

  private invalidSession(): UnauthorizedException {
    return new UnauthorizedException({
      status: 401,
      title: 'Unauthorized',
      code: 'AUTH_SESSION_INVALID',
      detail: 'The session is expired or invalid.',
    });
  }

  private invalidResetToken(): BadRequestException {
    return new BadRequestException({
      status: 400,
      title: 'Invalid request',
      code: 'AUTH_RESET_TOKEN_INVALID',
      detail: 'The reset link is invalid or has expired. Request a new one.',
    });
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
