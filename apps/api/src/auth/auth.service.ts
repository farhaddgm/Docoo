import { hash, verify } from '@node-rs/argon2';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
  readonly role: 'super_admin';
}

export interface AuthWorkspace {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: 'super_admin';
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
  password_hash: string;
  display_name: string;
  status: 'active' | 'locked' | 'disabled';
  locked: boolean;
}

interface WorkspaceRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  role: 'super_admin';
}

interface SessionUserRow extends QueryResultRow {
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

export const PASSWORD_MIN_LENGTH = 12;
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
      `select id, email, password_hash, display_name, status,
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

    if (!user || user.status !== 'active' || user.locked || !passwordMatches) {
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
        `select id, email, password_hash, display_name, status,
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
        'update users set failed_login_count = 0, locked_until = null where id = $1',
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

      return { ...session, user: this.toAuthUser(user), workspaces };
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
               where active_user.id = sessions.user_id and active_user.status = 'active'
            )
          returning user_id, absolute_expires_at,
                    least($2::integer, ceil(extract(epoch from absolute_expires_at - now()))::integer)
                      as cookie_max_age_seconds
       )
       select u.id, u.email, u.display_name, u.status, r.absolute_expires_at,
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
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: 'super_admin',
      },
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
      'select password_hash from users where id = $1',
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
      `select id, email from users where lower(email) = lower($1) and status = 'active' limit 1`,
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
        where t.token_digest = $1 and t.consumed_at is null and t.expires_at > now()
          and u.status = 'active'`,
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
          where t.token_digest = $1 and t.consumed_at is null and t.expires_at > now()
            and u.id = t.user_id and u.status = 'active'
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
    const tooLong = password.length > PASSWORD_MAX_LENGTH;
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
      role: 'super_admin',
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
