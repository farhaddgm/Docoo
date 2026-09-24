import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const locale = pgEnum('locale', ['fa', 'en']);
export const userStatus = pgEnum('user_status', ['active', 'locked', 'disabled']);
export const membershipRole = pgEnum('membership_role', ['super_admin']);
export const authEventAction = pgEnum('auth_event_action', [
  'login.failed',
  'login.succeeded',
  'logout.succeeded',
]);
export const projectStatus = pgEnum('project_status', [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
  'deleted',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    defaultLocale: locale('default_locale').notNull().default('fa'),
    ...timestamps,
  },
  (table) => [uniqueIndex('workspaces_code_uq').on(sql`lower(${table.code})`)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    status: userStatus('status').notNull().default('active'),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_uq').on(sql`lower(${table.email})`)],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull().default('super_admin'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('memberships_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ipHash: text('ip_hash'),
    userAgentHash: text('user_agent_hash'),
  },
  (table) => [
    uniqueIndex('sessions_token_digest_uq').on(table.tokenDigest),
    index('sessions_user_active_idx').on(table.userId, table.revokedAt),
  ],
);

export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: authEventAction('action').notNull(),
    identifierDigest: text('identifier_digest').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    ipHash: text('ip_hash'),
    userAgentHash: text('user_agent_hash'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_events_actor_time_idx').on(table.actorId, table.occurredAt),
    index('auth_events_correlation_idx').on(table.correlationId),
  ],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    language: locale('language').notNull().default('fa'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('topics_workspace_code_uq').on(table.workspaceId, sql`lower(${table.code})`),
    uniqueIndex('topics_workspace_title_uq').on(table.workspaceId, sql`lower(${table.title})`),
    index('topics_workspace_state_idx').on(table.workspaceId, table.archivedAt, table.deletedAt),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    initialProblem: text('initial_problem').notNull(),
    outputLanguage: locale('output_language').notNull().default('fa'),
    status: projectStatus('status').notNull().default('draft'),
    currentStage: text('current_stage').notNull().default('analysis'),
    pauseReason: text('pause_reason'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('projects_workspace_code_uq').on(table.workspaceId, sql`lower(${table.code})`),
    index('projects_workspace_status_idx').on(table.workspaceId, table.status, table.updatedAt),
  ],
);

export const projectTopics = pgTable(
  'project_topics',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'restrict' }),
    priority: integer('priority').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.topicId] }),
    uniqueIndex('project_topics_priority_uq').on(table.projectId, table.priority),
    index('project_topics_workspace_idx').on(table.workspaceId),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    correlationId: uuid('correlation_id').notNull(),
    securityRelevant: boolean('security_relevant').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_workspace_time_idx').on(table.workspaceId, table.occurredAt),
    index('audit_events_correlation_idx').on(table.correlationId),
  ],
);
