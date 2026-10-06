import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import {
  isGmail,
  normalizeGmail,
  type Account,
  type AccountInput,
  type AccountUpdate,
  type AccessLevel,
  type AccountRole,
  type LoginMethod,
} from '@docoo/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Environment } from '@docoo/config';
import { API_CONFIG, DATABASE_POOL } from '../tokens.js';
import { AuthService, type AuthRequestMetadata, type AuthUser } from './auth.service.js';

interface Row extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  account_role: AccountRole;
  login_method: LoginMethod;
  password_hash: string | null;
  status: string;
  last_login_at: Date | null;
  created_at: Date;
  workspace_ids: string[];
}
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: Environment,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  private public(row: Row): Account {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.account_role,
      loginMethod: row.login_method,
      isActive: row.status === 'active',
      hasPassword: !!row.password_hash,
      isOwner: this.auth.isOwner(row.email),
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      workspaceIds: row.workspace_ids ?? [],
    };
  }
  private async transaction<T>(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    ownerOnly: boolean,
    write: boolean,
    fn: (client: PoolClient, actor: AuthUser) => Promise<T>,
  ): Promise<T> {
    if (write) this.auth.assertSameOrigin(metadata);
    const session = await this.auth.currentSession(token);
    if (
      session.user.role !== 'super_admin' ||
      (ownerOnly && !this.auth.isOwner(session.user.email))
    )
      throw new ForbiddenException('Only the application owner can manage this access.');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (write)
        await client.query("select pg_advisory_xact_lock(hashtext('docoo.account_management'))");
      const active = await client.query(
        "select id from users where id=$1 and status='active' and account_role='super_admin' and deleted_at IS NULL" +
          (write ? ' for update' : ''),
        [session.user.id],
      );
      if (!active.rowCount) throw new ForbiddenException();
      await client.query("select set_config('app.actor_id',$1,true)", [session.user.id]);
      const result = await fn(client, session.user);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('An account with this email already exists.');
      throw error;
    } finally {
      client.release();
    }
  }
  private async row(client: PoolClient, id: string): Promise<Row> {
    const result = await client.query<Row>(
      'select * from users where id=$1 and deleted_at IS NULL',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    row.workspace_ids = [];
    return row;
  }
  private async audit(
    client: PoolClient,
    actor: AuthUser,
    id: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    await client.query(
      'insert into account_events(actor_id,target_id,action,details) values($1,$2,$3,$4::jsonb)',
      [actor.id, id, action, JSON.stringify(details)],
    );
  }
  private async revokeSessions(client: PoolClient, id: string) {
    await client.query(
      'update sessions set revoked_at=now() where user_id=$1 and revoked_at IS NULL',
      [id],
    );
    await client.query(
      'update password_reset_tokens set revoked_at=now() where user_id=$1 and consumed_at IS NULL and revoked_at IS NULL',
      [id],
    );
  }
  private password(password: string) {
    return hash(password, {
      memoryCost: this.config.PASSWORD_ARGON2_MEMORY_KIB,
      timeCost: this.config.PASSWORD_ARGON2_ITERATIONS,
      parallelism: this.config.PASSWORD_ARGON2_PARALLELISM,
    });
  }
  private async memberships(
    client: PoolClient,
    id: string,
    role: AccountRole,
    workspaceIds: readonly string[],
  ) {
    const catalog = await client.query<{ id: string }>(
      'select id from app.account_workspace_catalog()',
    );
    const allowed = new Set(catalog.rows.map((r) => r.id));
    if (workspaceIds.some((w) => !allowed.has(w)))
      throw new BadRequestException('Unknown workspace.');
    // Each write retains the existing tenant boundary.
    for (const w of catalog.rows) {
      await client.query("select set_config('app.workspace_id',$1,true)", [w.id]);
      if (workspaceIds.includes(w.id))
        await client.query(
          'insert into memberships(workspace_id,user_id,role) values($1,$2,$3::membership_role) on conflict(workspace_id,user_id) do update set role=excluded.role',
          [w.id, id, role],
        );
      else {
        await client.query('delete from resource_access where workspace_id=$1 and user_id=$2', [
          w.id,
          id,
        ]);
        await client.query('delete from memberships where workspace_id=$1 and user_id=$2', [
          w.id,
          id,
        ]);
      }
    }
  }
  async list(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    q = '',
    googleOnly = false,
    page = 1,
  ) {
    return this.transaction(token, metadata, googleOnly, false, async (client) => {
      const result = await client.query<Row>(
        `select * from users where deleted_at IS NULL and ($1='' or email ilike '%'||$1||'%' or display_name ilike '%'||$1||'%') and (not $2 or login_method<>'PASSWORD') order by created_at desc,id`,
        [q, googleOnly],
      );
      const all = googleOnly ? result.rows.filter((r) => !this.auth.isOwner(r.email)) : result.rows;
      const catalog = await client.query<{ id: string; code: string; name: string }>(
        'select * from app.account_workspace_catalog() order by code',
      );
      const items: Account[] = [];
      for (const row of all.slice((page - 1) * 20, page * 20)) {
        row.workspace_ids = [];
        for (const w of catalog.rows) {
          await client.query("select set_config('app.workspace_id',$1,true)", [w.id]);
          const member = await client.query(
            'select 1 from memberships where workspace_id=$1 and user_id=$2',
            [w.id, row.id],
          );
          if (member.rowCount) row.workspace_ids.push(w.id);
        }
        items.push(this.public(row));
      }
      return {
        items,
        total: all.length,
        page,
        totalPages: Math.max(1, Math.ceil(all.length / 20)),
        workspaces: catalog.rows,
      };
    });
  }
  async save(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    input: AccountInput | AccountUpdate,
    id?: string,
    googleGrant = false,
  ) {
    return this.transaction(token, metadata, googleGrant, true, async (client, actor) => {
      const owner = this.auth.isOwner(actor.email);
      let target: Row | undefined;
      if (id) target = await this.row(client, id);
      else if (googleGrant && 'email' in input) {
        const existing = await client.query<Row>(
          "select * from users where deleted_at IS NULL and app.normalize_gmail(email)=$1 order by (login_method<>'PASSWORD') desc limit 1",
          [normalizeGmail(input.email)],
        );
        target = existing.rows[0];
      }
      const email = target?.email ?? ('email' in input ? input.email : '');
      if (this.auth.isOwner(email) && (!owner || googleGrant))
        throw new ForbiddenException('The owner account is protected.');
      const method = input.loginMethod ?? target?.login_method ?? 'PASSWORD';
      const role = input.role ?? target?.account_role ?? 'editor';
      if ((!target && method !== 'PASSWORD') || (target && method !== target.login_method)) {
        if (!owner) throw new ForbiddenException('Only the owner can change sign-in methods.');
      }
      if (method !== 'PASSWORD' && !isGmail(email))
        throw new BadRequestException('Only Gmail addresses can use Google sign-in.');
      if (method === 'GOOGLE' && input.password)
        throw new BadRequestException('Google-only accounts have no password.');
      if (
        target?.id === actor.id &&
        (role !== 'super_admin' || ('isActive' in input && input.isActive === false))
      )
        throw new ForbiddenException('You cannot demote or deactivate yourself.');
      const passwordHash =
        method === 'GOOGLE'
          ? null
          : input.password
            ? await this.password(input.password)
            : target?.password_hash;
      if (method !== 'GOOGLE' && !passwordHash)
        throw new BadRequestException('A password is required.');
      let user: Row;
      const status =
        googleGrant && !id
          ? 'active'
          : 'isActive' in input && input.isActive !== undefined
            ? input.isActive
              ? 'active'
              : 'disabled'
            : (target?.status ?? 'active');
      if (target) {
        const r = await client.query<Row>(
          `update users set display_name=$2,account_role=$3,login_method=$4,password_hash=$5,status=$6::user_status,google_sub=CASE WHEN $4='PASSWORD' THEN NULL ELSE google_sub END,password_changed_at=CASE WHEN $7 THEN now() ELSE password_changed_at END where id=$1 returning *`,
          [
            target.id,
            input.displayName ?? target.display_name,
            role,
            method,
            passwordHash,
            status,
            !!input.password,
          ],
        );
        user = r.rows[0]!;
        if (
          input.password ||
          method !== target.login_method ||
          role !== target.account_role ||
          status !== target.status ||
          input.workspaceIds
        )
          await this.revokeSessions(client, user.id);
      } else {
        const r = await client.query<Row>(
          'insert into users(email,display_name,account_role,login_method,password_hash) values($1,$2,$3,$4,$5) returning *',
          [email, input.displayName, role, method, passwordHash],
        );
        user = r.rows[0]!;
      }
      if (input.workspaceIds) await this.memberships(client, user.id, role, input.workspaceIds);
      else if (target && role !== target.account_role) {
        const catalog = await client.query<{ id: string }>(
          'select id from app.account_workspace_catalog()',
        );
        for (const w of catalog.rows) {
          await client.query("select set_config('app.workspace_id',$1,true)", [w.id]);
          await client.query(
            'update memberships set role=$3::membership_role where workspace_id=$1 and user_id=$2',
            [w.id, user.id, role],
          );
        }
      }
      await this.audit(client, actor, user.id, target ? 'user.update' : 'user.create', {
        role,
        loginMethod: method,
        isActive: status === 'active',
        passwordReset: !!input.password,
      });
      return this.public(user);
    });
  }
  async remove(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    id: string,
    googleOnly = false,
  ) {
    return this.transaction(token, metadata, googleOnly, true, async (client, actor) => {
      const target = await this.row(client, id);
      if (this.auth.isOwner(target.email) || (!googleOnly && actor.id === id))
        throw new ForbiddenException('This account cannot be removed.');
      await this.revokeSessions(client, id);
      if (googleOnly)
        await client.query(
          `update users set login_method='PASSWORD',google_sub=NULL,status=CASE WHEN password_hash IS NULL THEN 'disabled'::user_status ELSE status END where id=$1`,
          [id],
        );
      else {
        const catalog = await client.query<{ id: string }>(
          'select id from app.account_workspace_catalog()',
        );
        for (const w of catalog.rows) {
          await client.query("select set_config('app.workspace_id',$1,true)", [w.id]);
          await client.query('delete from resource_access where workspace_id=$1 and user_id=$2', [
            w.id,
            id,
          ]);
          await client.query('delete from memberships where workspace_id=$1 and user_id=$2', [
            w.id,
            id,
          ]);
        }
        await client.query(
          `update users set email=id::text||'@deleted.invalid',display_name='Deleted account',status='disabled',password_hash=NULL,google_sub=NULL,login_method='PASSWORD',deleted_at=now() where id=$1`,
          [id],
        );
      }
      await this.audit(client, actor, id, googleOnly ? 'google_access.revoke' : 'user.delete', {});
    });
  }
  async access(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    id: string,
    workspaceId: string,
  ) {
    return this.transaction(token, metadata, true, false, async (client) => {
      const user = await this.row(client, id);
      await client.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
      const member = await client.query(
        'select 1 from memberships where workspace_id=$1 and user_id=$2',
        [workspaceId, id],
      );
      if (!member.rowCount) throw new NotFoundException();
      const query = async (kind: 'topic' | 'project') => {
        const table = kind === 'topic' ? 'topics' : 'projects';
        const result = await client.query<{
          id: string;
          title: string;
          created_by: string | null;
          access: AccessLevel | null;
        }>(
          `select r.id,r.title,r.created_by,a.access from ${table} r left join resource_access a on a.resource_id=r.id and a.workspace_id=r.workspace_id and a.user_id=$2 and a.kind=$3 where r.workspace_id=$1 order by r.title`,
          [workspaceId, id, kind],
        );
        return result.rows.map((r) => ({
          id: r.id,
          name: r.title,
          isCreator: r.created_by === id,
          granted: r.access,
          effective:
            user.account_role === 'super_admin'
              ? 'EDIT'
              : (r.access ?? (r.created_by === id ? 'EDIT' : null)),
        }));
      };
      return { topics: await query('topic'), projects: await query('project') };
    });
  }
  async setAccess(
    token: string | undefined,
    metadata: AuthRequestMetadata,
    id: string,
    workspaceId: string,
    kind: 'topic' | 'project',
    resourceId: string,
    access: AccessLevel | null,
  ) {
    return this.transaction(token, metadata, true, true, async (client, actor) => {
      const user = await this.row(client, id);
      if (user.account_role === 'super_admin')
        throw new BadRequestException('Administrators have access to everything.');
      await client.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
      const member = await client.query(
        'select 1 from memberships where workspace_id=$1 and user_id=$2',
        [workspaceId, id],
      );
      if (!member.rowCount) throw new NotFoundException();
      const result = await client.query<{ created_by: string | null }>(
        `select created_by from ${kind === 'topic' ? 'topics' : 'projects'} where workspace_id=$1 and id=$2`,
        [workspaceId, resourceId],
      );
      const target = result.rows[0];
      if (!target) throw new NotFoundException();
      if (access === null && target.created_by === id)
        throw new BadRequestException('Creators retain access to their own items.');
      if (access)
        await client.query(
          `insert into resource_access(workspace_id,user_id,kind,resource_id,access,granted_by) values($1,$2,$3,$4,$5,$6) on conflict(workspace_id,user_id,kind,resource_id) do update set access=excluded.access,granted_by=excluded.granted_by,updated_at=now()`,
          [workspaceId, id, kind, resourceId, access, actor.id],
        );
      else
        await client.query(
          'delete from resource_access where workspace_id=$1 and user_id=$2 and kind=$3 and resource_id=$4',
          [workspaceId, id, kind, resourceId],
        );
      await this.audit(client, actor, id, `${kind}_access.set`, {
        workspaceId,
        resourceId,
        access,
      });
      return { access };
    });
  }
}
