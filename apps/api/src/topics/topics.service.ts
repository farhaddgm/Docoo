import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setDatabaseRequestContext } from '@docoo/database';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import { DATABASE_POOL } from '../tokens.js';

const uuidSchema = z.uuid();
const createdAtSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
const cursorSchema = z
  .object({
    version: z.literal(1),
    workspaceId: uuidSchema,
    createdAt: createdAtSchema,
    id: uuidSchema,
  })
  .strict();

export interface Topic {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: 'fa' | 'en';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTopicInput {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly language: 'fa' | 'en';
}

export interface TopicRequestContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export interface ListTopicsInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface TopicPage {
  readonly items: readonly Topic[];
  readonly nextCursor: string | null;
}

interface TopicRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  code: string;
  title: string;
  description: string;
  language: 'fa' | 'en';
  created_at: string;
  updated_at: string;
}

const topicColumns = `
  id, workspace_id, code, title, description, language,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`;

@Injectable()
export class TopicsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(context: TopicRequestContext, input: ListTopicsInput): Promise<TopicPage> {
    const cursor = input.cursor ? this.decodeCursor(input.cursor, context.workspaceId) : null;
    return this.withContext(context, async (client) => {
      const result = await client.query<TopicRow>(
        `select ${topicColumns}
           from topics
          where workspace_id = $1
            and archived_at is null
            and deleted_at is null
            and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
          order by created_at desc, id desc
          limit $4`,
        [context.workspaceId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
      );
      const visibleRows = result.rows.slice(0, input.limit);
      const last = visibleRows.at(-1);
      return {
        items: visibleRows.map((row) => this.toTopic(row)),
        nextCursor:
          result.rows.length > input.limit && last
            ? this.encodeCursor(context.workspaceId, last)
            : null,
      };
    });
  }

  async create(context: TopicRequestContext, input: CreateTopicInput): Promise<Topic> {
    return this.withContext(context, async (client) => {
      let result;
      try {
        result = await client.query<TopicRow>(
          `with inserted as (
             insert into topics (workspace_id, code, title, description, language)
             values ($1, $2, $3, $4, $5)
             returning *
           )
           select ${topicColumns} from inserted`,
          [context.workspaceId, input.code, input.title, input.description, input.language],
        );
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException({
            status: 409,
            title: 'Conflict',
            code: 'TOPIC_ALREADY_EXISTS',
            detail: 'A topic with this code or title already exists in the workspace.',
          });
        }
        throw error;
      }

      const row = result.rows[0];
      if (!row) throw new Error('Topic insert did not return a row');
      await client.query(
        `insert into audit_events (
           workspace_id, actor_id, action, target_type, target_id,
           after, correlation_id, security_relevant
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          context.workspaceId,
          context.actorId,
          'topic.create',
          'topic',
          row.id,
          JSON.stringify({ redacted: true, fields: ['code', 'title', 'description', 'language'] }),
          uuidSchema.safeParse(context.correlationId).success
            ? context.correlationId
            : randomUUID(),
          false,
        ],
      );
      return this.toTopic(row);
    });
  }

  private async withContext<T>(
    context: TopicRequestContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await setDatabaseRequestContext(client, {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        correlationId: uuidSchema.safeParse(context.correlationId).success
          ? context.correlationId
          : randomUUID(),
      });
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

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private decodeCursor(raw: string, workspaceId: string): z.infer<typeof cursorSchema> {
    try {
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new Error('Invalid cursor encoding');
      const json = Buffer.from(raw, 'base64url').toString('utf8');
      if (Buffer.from(json).toString('base64url') !== raw)
        throw new Error('Invalid cursor encoding');
      const cursor = cursorSchema.parse(JSON.parse(json));
      if (cursor.workspaceId !== workspaceId || !Number.isFinite(Date.parse(cursor.createdAt))) {
        throw new Error('Invalid cursor context');
      }
      return cursor;
    } catch {
      throw new BadRequestException({
        status: 400,
        title: 'Invalid request',
        code: 'TOPIC_CURSOR_INVALID',
        detail: 'The page cursor is invalid.',
      });
    }
  }

  private encodeCursor(workspaceId: string, row: TopicRow): string {
    return Buffer.from(
      JSON.stringify({ version: 1, workspaceId, createdAt: row.created_at, id: row.id }),
    ).toString('base64url');
  }

  private toTopic(row: TopicRow): Topic {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      code: row.code,
      title: row.title,
      description: row.description,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
