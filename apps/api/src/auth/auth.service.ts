import { hash, verify } from '@node-rs/argon2';
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: 'active' | 'locked' | 'disabled';
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

interface CreateSessionInput {
  readonly actorId: string | null;
  readonly action: 'login.failed' | 'login.succeeded' | 'logout.succeeded';
  readonly identifierDigest: string;
  readonly correlationId: string;
  readonly ipHash: string | null;
  readonly userAgentHash: string | null;
}

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
    const identifierDigest = digestSecret(identifier.toLowerCase(), this.config.SESSION_PEPPER);
    const userResult = await this.pool.query<UserRow>(
      `select id, email, password_hash, display_name, status
         from users
        where lower(email) = lower($1)
        limit 1`,
      [identifier],
    );
    const user = userResult.rows[0];
    const passwordMatches = await verify(
      user?.password_hash ?? (await this.dummyPasswordHash),
      password,
    );

    if (!user || user.status !== 'active' || !passwordMatches) {
      await this.recordAuthEvent({
        actorId: user?.id ?? null,
        action: 'login.failed',
        identifierDigest,
        ...this.auditMetadata(metadata),
      });
      throw this.invalidCredentials();
    }

    const client = await this.pool.connect();
    const token = createSessionToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + this.config.SESSION_IDLE_TTL_SECONDS * 1000);
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    );
    const maxAgeSeconds = Math.min(
      this.config.SESSION_IDLE_TTL_SECONDS,
      this.config.SESSION_ABSOLUTE_TTL_SECONDS,
    );

    try {
      await client.query('begin');
      const currentUserResult = await client.query<UserRow>(
        `select id, email, password_hash, display_name, status
           from users
          where id = $1
          for update`,
        [user.id],
      );
      const currentUser = currentUserResult.rows[0];
      if (
        !currentUser ||
        currentUser.status !== 'active' ||
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
        `insert into sessions (
           user_id, token_digest, last_seen_at, idle_expires_at, absolute_expires_at,
           ip_hash, user_agent_hash
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.id,
          digestSecret(token, this.config.SESSION_PEPPER),
          now,
          idleExpiresAt,
          absoluteExpiresAt,
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
      await client.query('commit');

      return {
        token,
        maxAgeSeconds,
        user: this.toAuthUser(user),
        workspaces,
      };
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
      [digestSecret(token, this.config.SESSION_PEPPER), this.config.SESSION_IDLE_TTL_SECONDS],
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
    const digest = digestSecret(token, this.config.SESSION_PEPPER);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
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
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
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

  private async recordAuthEvent(input: CreateSessionInput): Promise<void> {
    await this.insertAuthEvent(this.pool, input);
  }

  private async insertAuthEvent(
    connection: Pool | PoolClient,
    input: CreateSessionInput,
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
  ): Pick<CreateSessionInput, 'correlationId' | 'ipHash' | 'userAgentHash'> {
    return {
      correlationId: this.isUuid(metadata.correlationId) ? metadata.correlationId : randomUUID(),
      ipHash: this.digestOptional(metadata.ip),
      userAgentHash: this.digestOptional(metadata.userAgent),
    };
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

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
