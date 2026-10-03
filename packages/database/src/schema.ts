import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
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
  'login.locked',
  'password.changed',
  'password.reset_requested',
  'password.reset_completed',
  'sessions.revoked',
]);
export const auditSeverity = pgEnum('audit_severity', ['info', 'warning', 'critical']);
export const configScope = pgEnum('config_scope', ['workspace', 'topic', 'project']);
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
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
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

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenDigest: text('token_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_digest_uq').on(table.tokenDigest),
    index('password_reset_tokens_user_idx').on(table.userId, table.consumedAt),
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
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('topics_workspace_code_uq').on(table.workspaceId, sql`lower(${table.code})`),
    uniqueIndex('topics_workspace_title_uq').on(table.workspaceId, sql`lower(${table.title})`),
    index('topics_workspace_state_idx').on(table.workspaceId, table.archivedAt, table.deletedAt),
  ],
);

export const topicVersions = pgTable(
  'topic_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    language: locale('language').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('topic_versions_topic_version_uq').on(table.topicId, table.version),
    index('topic_versions_workspace_idx').on(table.workspaceId),
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
    previousStatus: projectStatus('previous_status'),
    currentStage: text('current_stage').notNull().default('analysis'),
    pauseReason: text('pause_reason'),
    configSnapshotId: uuid('config_snapshot_id'),
    clonedFromId: uuid('cloned_from_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
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
    conflictInstruction: text('conflict_instruction'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.topicId] }),
    index('project_topics_topic_idx').on(table.topicId),
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
    projectId: uuid('project_id'),
    severity: auditSeverity('severity').notNull().default('info'),
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
    index('audit_events_project_time_idx').on(table.workspaceId, table.projectId, table.occurredAt),
    index('audit_events_target_idx').on(table.workspaceId, table.targetType, table.targetId),
  ],
);

export const settingDefinitions = pgTable('setting_definitions', {
  key: text('key').primaryKey(),
  valueSchema: jsonb('value_schema').notNull(),
  defaultValue: jsonb('default_value').notNull(),
  allowedScopes: configScope('allowed_scopes').array().notNull(),
  sensitive: boolean('sensitive').notNull().default(false),
  descriptionFa: text('description_fa').notNull(),
  descriptionEn: text('description_en').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const configAssignments = pgTable(
  'config_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    settingKey: text('setting_key')
      .notNull()
      .references(() => settingDefinitions.key, { onDelete: 'restrict' }),
    scopeType: configScope('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    sequence: integer('sequence').notNull(),
    value: jsonb('value'),
    cleared: boolean('cleared').notNull().default(false),
    reason: text('reason').notNull(),
    restoredFromSequence: integer('restored_from_sequence'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('config_assignments_sequence_uq').on(
      table.workspaceId,
      table.settingKey,
      table.scopeType,
      table.scopeId,
      table.sequence,
    ),
    index('config_assignments_scope_idx').on(table.workspaceId, table.scopeType, table.scopeId),
  ],
);

export const configSnapshots = pgTable(
  'config_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    subjectType: configScope('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    resolved: jsonb('resolved').notNull(),
    sourceMap: jsonb('source_map').notNull(),
    hash: text('hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('config_snapshots_subject_hash_uq').on(
      table.workspaceId,
      table.subjectType,
      table.subjectId,
      table.hash,
    ),
  ],
);

// Phase 2: sources, ingestion, knowledge, Brain audit and retrieval (ING-*, KNO-*).

export const sourceKind = pgEnum('source_kind', ['file', 'url', 'text']);
export const sourceStatus = pgEnum('source_status', [
  'uploaded',
  'quarantined',
  'scanning',
  'accepted',
  'extracting',
  'indexed',
  'rejected',
  'failed',
  'partial',
]);
export const knowledgeSourceType = pgEnum('knowledge_source_type', [
  'admin_provided',
  'clue_guided',
  'autonomous_research',
]);
export const confidentiality = pgEnum('confidentiality', [
  'internal',
  'confidential',
  'restricted',
]);
export const knowledgeStatus = pgEnum('knowledge_status', [
  'draft',
  'pending',
  'in_review',
  'approved',
  'rejected',
  'needs_revision',
  'expired',
  'superseded',
]);
export const auditDecision = pgEnum('audit_decision', ['approved', 'needs_revision', 'rejected']);
export const overrideDecision = pgEnum('override_decision', ['approve', 'reject']);
export const conflictStatus = pgEnum('conflict_status', ['open', 'resolved']);
export const conflictSeverity = pgEnum('conflict_severity', ['low', 'medium', 'high']);

export const sourceAssets = pgTable(
  'source_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    kind: sourceKind('kind').notNull(),
    title: text('title').notNull(),
    scopeType: configScope('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    currentVersionId: uuid('current_version_id'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('source_assets_workspace_idx').on(table.workspaceId, table.updatedAt),
    index('source_assets_scope_idx').on(table.workspaceId, table.scopeType, table.scopeId),
  ],
);

export const sourceVersions = pgTable(
  'source_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => sourceAssets.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    status: sourceStatus('status').notNull().default('uploaded'),
    objectKey: text('object_key'),
    filename: text('filename'),
    declaredMime: text('declared_mime'),
    sniffedMime: text('sniffed_mime'),
    declaredSize: bigint('declared_size', { mode: 'number' }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    declaredSha256: text('declared_sha256'),
    sha256: text('sha256'),
    originUrl: text('origin_url'),
    scan: jsonb('scan'),
    extraction: jsonb('extraction'),
    failureCode: text('failure_code'),
    supersedesVersionId: uuid('supersedes_version_id'),
    uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('source_versions_asset_version_uq').on(table.assetId, table.versionNo),
    index('source_versions_workspace_status_idx').on(table.workspaceId, table.status),
    index('source_versions_sha_idx').on(table.workspaceId, table.sha256),
  ],
);

export const sourceSegments = pgTable(
  'source_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    sourceVersionId: uuid('source_version_id')
      .notNull()
      .references(() => sourceVersions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    locator: jsonb('locator').notNull(),
    text: text('text').notNull(),
    confidence: real('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('source_segments_version_ordinal_uq').on(table.sourceVersionId, table.ordinal),
    index('source_segments_workspace_idx').on(table.workspaceId),
  ],
);

export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    sourceType: knowledgeSourceType('source_type').notNull(),
    confidentiality: confidentiality('confidentiality').notNull().default('internal'),
    language: locale('language').notNull().default('fa'),
    currentVersionId: uuid('current_version_id'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('knowledge_items_workspace_idx').on(table.workspaceId, table.updatedAt)],
);

export const knowledgeScopes = pgTable(
  'knowledge_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    scopeType: configScope('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    role: text('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_scopes_uq').on(
      table.itemId,
      table.scopeType,
      table.scopeId,
      sql`coalesce(${table.role}, '')`,
    ),
    index('knowledge_scopes_lookup_idx').on(table.workspaceId, table.scopeType, table.scopeId),
  ],
);

export const knowledgeVersions = pgTable(
  'knowledge_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    status: knowledgeStatus('status').notNull().default('draft'),
    content: text('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    language: locale('language').notNull(),
    sourceVersionId: uuid('source_version_id').references(() => sourceVersions.id, {
      onDelete: 'set null',
    }),
    provenance: jsonb('provenance').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    staleReason: text('stale_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('knowledge_versions_item_version_uq').on(table.itemId, table.versionNo),
    index('knowledge_versions_workspace_status_idx').on(table.workspaceId, table.status),
    index('knowledge_versions_source_idx').on(table.sourceVersionId),
  ],
);

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    knowledgeVersionId: uuid('knowledge_version_id')
      .notNull()
      .references(() => knowledgeVersions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    kind: text('kind').notNull(),
    locator: jsonb('locator').notNull(),
    sourceSegmentId: uuid('source_segment_id').references(() => sourceSegments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('claims_version_ordinal_uq').on(table.knowledgeVersionId, table.ordinal),
    index('claims_workspace_idx').on(table.workspaceId),
  ],
);

export const citations = pgTable(
  'citations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    sourceRef: text('source_ref'),
    title: text('title'),
    publisher: text('publisher'),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    accessedAt: timestamp('accessed_at', { withTimezone: true }),
    locator: text('locator'),
    quoteDigest: text('quote_digest'),
    complete: boolean('complete').notNull(),
    missingFields: text('missing_fields').array().notNull(),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('citations_claim_idx').on(table.claimId),
    index('citations_workspace_idx').on(table.workspaceId),
  ],
);

export const auditReviews = pgTable(
  'audit_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    knowledgeVersionId: uuid('knowledge_version_id')
      .notNull()
      .references(() => knowledgeVersions.id, { onDelete: 'cascade' }),
    rubricVersion: text('rubric_version').notNull(),
    auditor: text('auditor').notNull(),
    scores: jsonb('scores').notNull(),
    overall: real('overall').notNull(),
    decision: auditDecision('decision').notNull(),
    reasons: jsonb('reasons').notNull(),
    claimResults: jsonb('claim_results').notNull(),
    criticalFlags: text('critical_flags').array().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_reviews_version_idx').on(table.knowledgeVersionId, table.createdAt),
    index('audit_reviews_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const auditOverrides = pgTable(
  'audit_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => auditReviews.id, { onDelete: 'cascade' }),
    knowledgeVersionId: uuid('knowledge_version_id')
      .notNull()
      .references(() => knowledgeVersions.id, { onDelete: 'cascade' }),
    decision: overrideDecision('decision').notNull(),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_overrides_version_idx').on(table.knowledgeVersionId, table.createdAt)],
);

export const knowledgeConflicts = pgTable(
  'knowledge_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    claimAId: uuid('claim_a_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    claimBId: uuid('claim_b_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    conflictType: text('conflict_type').notNull(),
    severity: conflictSeverity('severity').notNull(),
    analysis: text('analysis').notNull(),
    status: conflictStatus('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_conflicts_pair_uq').on(table.claimAId, table.claimBId),
    index('knowledge_conflicts_workspace_status_idx').on(table.workspaceId, table.status),
  ],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    knowledgeVersionId: uuid('knowledge_version_id')
      .notNull()
      .references(() => knowledgeVersions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    searchText: text('search_text').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_chunks_version_ordinal_uq').on(table.knowledgeVersionId, table.ordinal),
    index('knowledge_chunks_workspace_idx').on(table.workspaceId),
  ],
);

export const retrievalSnapshots = pgTable(
  'retrieval_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id'),
    topicId: uuid('topic_id'),
    role: text('role'),
    query: text('query').notNull(),
    filters: jsonb('filters').notNull(),
    results: jsonb('results').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    hash: text('hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('retrieval_snapshots_workspace_idx').on(table.workspaceId, table.createdAt)],
);

// Phase 3: provider orchestration (AI-*) and project workflows (WF-*).

export const providerKind = pgEnum('provider_kind', ['openai', 'gemini', 'anthropic', 'fake']);
export const providerStatus = pgEnum('provider_status', [
  'unconfigured',
  'configured',
  'checking',
  'healthy',
  'invalid',
  'degraded',
  'unavailable',
]);
export const invocationStatus = pgEnum('invocation_status', [
  'succeeded',
  'transient_failed',
  'permanent_failed',
]);
export const workflowStatus = pgEnum('workflow_status', [
  'starting',
  'running',
  'paused',
  'waiting_for_human',
  'completed',
  'cancelled',
  'failed',
]);
export const stageKind = pgEnum('stage_kind', [
  'analysis',
  'research',
  'ideation',
  'documentation',
  'evaluation',
]);
export const stageStatus = pgEnum('stage_status', [
  'pending',
  'ready',
  'running',
  'waiting_for_human',
  'retrying',
  'completed',
  'rejected',
  'failed',
  'cancelled',
]);
export const attemptStatus = pgEnum('attempt_status', [
  'created',
  'dispatched',
  'executing',
  'succeeded',
  'incomplete',
  'transient_failed',
  'scheduled_retry',
  'permanent_failed',
]);
export const reviewAction = pgEnum('review_action', ['approve', 'reject', 'edit', 'comment']);
export const gateStatus = pgEnum('gate_status', [
  'not_required',
  'pending',
  'approved',
  'rejected',
  'overridden',
  'expired',
]);
export const humanTaskStatus = pgEnum('human_task_status', ['pending', 'resolved', 'cancelled']);

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    provider: providerKind('provider').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url'),
    status: providerStatus('status').notNull().default('unconfigured'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastLatencyMs: integer('last_latency_ms'),
    lastError: text('last_error'),
    currentSecretVersion: integer('current_secret_version').notNull().default(0),
    storeContent: boolean('store_content').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('provider_connections_name_uq').on(table.workspaceId, sql`lower(${table.name})`),
  ],
);

export const providerSecrets = pgTable(
  'provider_secrets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    secretVersion: integer('secret_version').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    tag: text('tag').notNull(),
    wrappedKey: text('wrapped_key').notNull(),
    wrapIv: text('wrap_iv').notNull(),
    wrapTag: text('wrap_tag').notNull(),
    keyId: text('key_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_secrets_version_uq').on(table.connectionId, table.secretVersion),
  ],
);

export const modelCatalogSnapshots = pgTable(
  'model_catalog_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    models: jsonb('models').notNull(),
    modelCount: integer('model_count').notNull(),
    hash: text('hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('model_catalog_snapshots_connection_idx').on(table.connectionId, table.createdAt),
  ],
);

export const modelPrices = pgTable(
  'model_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    provider: providerKind('provider').notNull(),
    model: text('model').notNull(),
    inputPerMillion: real('input_per_million').notNull(),
    outputPerMillion: real('output_per_million').notNull(),
    cachedInputPerMillion: real('cached_input_per_million'),
    reasoningPerMillion: real('reasoning_per_million'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('model_prices_lookup_idx').on(
      table.workspaceId,
      table.provider,
      table.model,
      table.effectiveFrom,
    ),
  ],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runNo: integer('run_no').notNull(),
    temporalWorkflowId: text('temporal_workflow_id').notNull(),
    status: workflowStatus('status').notNull().default('starting'),
    currentStage: stageKind('current_stage'),
    configSnapshotId: uuid('config_snapshot_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workflow_runs_project_run_uq').on(table.projectId, table.runNo),
    uniqueIndex('workflow_runs_temporal_uq').on(table.temporalWorkflowId),
  ],
);

export const stageRuns = pgTable(
  'stage_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stage: stageKind('stage').notNull(),
    sequence: integer('sequence').notNull(),
    status: stageStatus('status').notNull().default('pending'),
    gateMode: text('gate_mode').notNull().default('manual'),
    attemptLimit: integer('attempt_limit').notNull().default(10),
    attemptsUsed: integer('attempts_used').notNull().default(0),
    latestOutputId: uuid('latest_output_id'),
    passedByDecision: boolean('passed_by_decision').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('stage_runs_run_stage_uq').on(table.runId, table.stage),
    index('stage_runs_project_idx').on(table.workspaceId, table.projectId),
  ],
);

export const stageAttempts = pgTable(
  'stage_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stageRunId: uuid('stage_run_id')
      .notNull()
      .references(() => stageRuns.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: attemptStatus('status').notNull().default('created'),
    retryOf: uuid('retry_of'),
    providerRetries: integer('provider_retries').notNull().default(0),
    outputId: uuid('output_id'),
    feedback: text('feedback'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('stage_attempts_number_uq').on(table.stageRunId, table.attemptNo),
    uniqueIndex('stage_attempts_idempotency_uq').on(table.idempotencyKey),
  ],
);

export const stageOutputs = pgTable(
  'stage_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stageRunId: uuid('stage_run_id')
      .notNull()
      .references(() => stageRuns.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => stageAttempts.id, { onDelete: 'set null' }),
    versionNo: integer('version_no').notNull(),
    content: jsonb('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    origin: text('origin').notNull(),
    editedFromId: uuid('edited_from_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stage_outputs_version_uq').on(table.stageRunId, table.versionNo)],
);

export const stageReviews = pgTable(
  'stage_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stageRunId: uuid('stage_run_id')
      .notNull()
      .references(() => stageRuns.id, { onDelete: 'cascade' }),
    outputId: uuid('output_id')
      .notNull()
      .references(() => stageOutputs.id, { onDelete: 'cascade' }),
    action: reviewAction('action').notNull(),
    comment: text('comment'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('stage_reviews_stage_idx').on(table.stageRunId, table.createdAt)],
);

export const gateDecisions = pgTable(
  'gate_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    stageRunId: uuid('stage_run_id')
      .notNull()
      .references(() => stageRuns.id, { onDelete: 'cascade' }),
    outputId: uuid('output_id')
      .notNull()
      .references(() => stageOutputs.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    status: gateStatus('status').notNull().default('pending'),
    reason: text('reason'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('gate_decisions_stage_idx').on(table.stageRunId, table.status)],
);

export const humanTasks = pgTable(
  'human_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stageRunId: uuid('stage_run_id').references(() => stageRuns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: humanTaskStatus('status').notNull().default('pending'),
    title: text('title').notNull(),
    payload: jsonb('payload').notNull(),
    resolution: jsonb('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('human_tasks_workspace_status_idx').on(table.workspaceId, table.status, table.createdAt),
  ],
);

export const modelInvocations = pgTable(
  'model_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    projectId: uuid('project_id'),
    stageRunId: uuid('stage_run_id'),
    attemptId: uuid('attempt_id'),
    provider: providerKind('provider').notNull(),
    model: text('model').notNull(),
    purpose: text('purpose').notNull(),
    status: invocationStatus('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    latencyMs: integer('latency_ms'),
    finishReason: text('finish_reason'),
    rawFinishReason: text('raw_finish_reason'),
    costUsd: real('cost_usd'),
    priceId: uuid('price_id'),
    providerRequestId: text('provider_request_id'),
    errorCode: text('error_code'),
    retryNo: integer('retry_no').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('model_invocations_project_idx').on(table.workspaceId, table.projectId, table.createdAt),
    index('model_invocations_connection_idx').on(table.connectionId, table.createdAt),
  ],
);

export const commandReceipts = pgTable(
  'command_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    command: text('command').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('command_receipts_key_uq').on(table.workspaceId, table.idempotencyKey)],
);

// Phase 4: solutions, documents and evaluation (SOL-*, DOC-*, EVA-*).

export const documentStatus = pgEnum('document_status', [
  'draft',
  'ready_for_review',
  'non_compliant',
  'approved',
  'rejected',
  'locked',
  'superseded',
]);
export const evaluationStatus = pgEnum('evaluation_status', [
  'passed',
  'failed_quality',
  'failed_compliance',
  'needs_human_decision',
  'technical_error',
]);
export const findingSeverity = pgEnum('finding_severity', [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);

const tenant = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'restrict' });

export const solutionCriteriaVersions = pgTable(
  'solution_criteria_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    criteria: jsonb('criteria').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('solution_criteria_versions_uq').on(table.projectId, table.versionNo)],
);

export const solutionSets = pgTable(
  'solution_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    requestedCount: integer('requested_count').notNull(),
    origin: text('origin').notNull(),
    invocationId: uuid('invocation_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('solution_sets_project_idx').on(table.projectId, table.createdAt)],
);

export const solutions = pgTable(
  'solutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    setId: uuid('set_id')
      .notNull()
      .references(() => solutionSets.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    assumptions: jsonb('assumptions').notNull(),
    evidence: jsonb('evidence').notNull(),
    plan: jsonb('plan').notNull(),
    risks: jsonb('risks').notNull(),
    scoreInputs: jsonb('score_inputs').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('solutions_set_ordinal_uq').on(table.setId, table.ordinal)],
);

export const solutionSelections = pgTable(
  'solution_selections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    setId: uuid('set_id')
      .notNull()
      .references(() => solutionSets.id, { onDelete: 'cascade' }),
    selected: jsonb('selected').notNull(),
    criteriaVersionId: uuid('criteria_version_id'),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('solution_selections_project_idx').on(table.projectId, table.createdAt)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    solutionId: uuid('solution_id').references(() => solutions.id, { onDelete: 'set null' }),
    priority: integer('priority').notNull().default(1),
    title: text('title').notNull(),
    level: integer('level').notNull(),
    language: locale('language').notNull(),
    status: documentStatus('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    approvedVersionId: uuid('approved_version_id'),
    approvalKind: text('approval_kind'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('documents_project_idx').on(table.workspaceId, table.projectId),
    uniqueIndex('documents_solution_uq').on(table.projectId, table.solutionId),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    content: jsonb('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    charCount: integer('char_count').notNull(),
    countAlgorithm: text('count_algorithm').notNull(),
    level: integer('level').notNull(),
    bounds: jsonb('bounds').notNull(),
    withinBounds: boolean('within_bounds').notNull(),
    origin: text('origin').notNull(),
    restoredFromId: uuid('restored_from_id'),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('document_versions_uq').on(table.documentId, table.versionNo)],
);

export const documentArtifacts = pgTable(
  'document_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    format: text('format').notNull(),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    templateVersion: text('template_version').notNull(),
    signature: text('signature').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('document_artifacts_document_idx').on(table.documentId, table.createdAt)],
);

export const rubricVersions = pgTable(
  'rubric_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    rubric: jsonb('rubric').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rubric_versions_uq').on(
      table.workspaceId,
      sql`coalesce(${table.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.versionNo,
    ),
  ],
);

export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    rubricVersionId: uuid('rubric_version_id'),
    rubric: jsonb('rubric').notNull(),
    status: evaluationStatus('status').notNull(),
    overall: real('overall').notNull(),
    scores: jsonb('scores').notNull(),
    evaluator: text('evaluator').notNull(),
    invocationId: uuid('invocation_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evaluations_document_idx').on(table.documentId, table.createdAt)],
);

export const evaluationFindings = pgTable(
  'evaluation_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    severity: findingSeverity('severity').notNull(),
    criterion: text('criterion').notNull(),
    evidence: text('evidence').notNull(),
    location: text('location').notNull(),
    defaultTargetStage: stageKind('default_target_stage').notNull(),
    targetStage: stageKind('target_stage').notNull(),
    targetReason: text('target_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evaluation_findings_evaluation_idx').on(table.evaluationId)],
);

export const evaluationExceptions = pgTable(
  'evaluation_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('evaluation_exceptions_uq').on(table.evaluationId)],
);

export const brainReportScope = pgEnum('brain_report_scope', ['project', 'workspace']);

/** REP-002: Brain performance reports are recommendations only and never change state. */
export const brainReports = pgTable(
  'brain_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenant(),
    scope: brainReportScope('scope').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    charterVersion: text('charter_version').notNull(),
    periodFrom: timestamp('period_from', { withTimezone: true }),
    periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
    summary: jsonb('summary').notNull(),
    deviations: jsonb('deviations').notNull(),
    recommendations: jsonb('recommendations').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('brain_reports_latest_idx').on(table.workspaceId, table.scope, table.createdAt),
    index('brain_reports_project_idx').on(table.projectId, table.createdAt),
  ],
);
