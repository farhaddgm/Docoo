import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { modelInvocations, projects, users } from './schema.js';

export const projectEvaluationExperiments = pgTable(
  'project_evaluation_experiments',
  {
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    manifestJson: jsonb('manifest_json').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    status: text('status').notNull().default('running'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.projectId, table.experimentId] }),
    foreignKey({
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    check(
      'evaluation_experiment_status_check',
      sql`${table.status} IN ('running','completed','failed','cancelled')`,
    ),
    check(
      'evaluation_experiment_finish_check',
      sql`(${table.status}='running')=(${table.finishedAt} IS NULL)`,
    ),
    check('evaluation_experiment_hash_check', sql`${table.manifestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const projectEvaluationCaseResults = pgTable(
  'project_evaluation_case_results',
  {
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    resultJson: jsonb('result_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.experimentId, table.ordinal],
    }),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.experimentId],
      foreignColumns: [
        projectEvaluationExperiments.workspaceId,
        projectEvaluationExperiments.projectId,
        projectEvaluationExperiments.experimentId,
      ],
    }),
    check('evaluation_result_ordinal_check', sql`${table.ordinal} BETWEEN 0 AND 999`),
  ],
);

export const projectEvaluationExperimentReviews = pgTable(
  'project_evaluation_experiment_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    reviewJson: jsonb('review_json').notNull(),
    comparisonJson: jsonb('comparison_json').notNull(),
    reviewHash: text('review_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.experimentId],
      foreignColumns: [
        projectEvaluationExperiments.workspaceId,
        projectEvaluationExperiments.projectId,
        projectEvaluationExperiments.experimentId,
      ],
    }),
    unique('project_evaluation_experiment_review_hash_uq').on(
      table.workspaceId,
      table.projectId,
      table.experimentId,
      table.reviewHash,
    ),
    check('evaluation_review_hash_check', sql`${table.reviewHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const projectEvaluationReviewCommands = pgTable(
  'project_evaluation_review_commands',
  {
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    commandKey: text('command_key').notNull(),
    requestHash: text('request_hash').notNull(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => projectEvaluationExperimentReviews.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.experimentId, table.commandKey],
    }),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.experimentId],
      foreignColumns: [
        projectEvaluationExperiments.workspaceId,
        projectEvaluationExperiments.projectId,
        projectEvaluationExperiments.experimentId,
      ],
    }),
    check(
      'evaluation_review_command_key_check',
      sql`${table.commandKey} ~ '^[A-Za-z0-9._:-]{8,200}$'`,
    ),
    check('evaluation_review_command_hash_check', sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const projectEvaluationInvocationJournal = pgTable(
  'project_evaluation_invocation_journal',
  {
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    experimentId: text('experiment_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    intentJson: jsonb('intent_json').notNull(),
    intentHash: text('intent_hash').notNull(),
    status: text('status').notNull().default('pending'),
    receiptJson: jsonb('receipt_json'),
    receiptHash: text('receipt_hash'),
    invocationId: uuid('invocation_id')
      .unique()
      .references(() => modelInvocations.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.projectId, table.experimentId, table.ordinal],
    }),
    foreignKey({
      columns: [table.workspaceId, table.projectId, table.experimentId],
      foreignColumns: [
        projectEvaluationExperiments.workspaceId,
        projectEvaluationExperiments.projectId,
        projectEvaluationExperiments.experimentId,
      ],
    }),
    check(
      'evaluation_invocation_status_check',
      sql`${table.status} IN ('pending','returned','unknown')`,
    ),
    check(
      'evaluation_invocation_finish_check',
      sql`(${table.status}='pending')=(${table.finishedAt} IS NULL)`,
    ),
    check(
      'evaluation_invocation_receipt_check',
      sql`(${table.status}='returned')=(${table.receiptJson} IS NOT NULL AND ${table.receiptHash} IS NOT NULL AND ${table.invocationId} IS NOT NULL)`,
    ),
    check(
      'evaluation_invocation_no_partial_receipt',
      sql`${table.status}='returned' OR (${table.receiptJson} IS NULL AND ${table.receiptHash} IS NULL AND ${table.invocationId} IS NULL)`,
    ),
  ],
);
