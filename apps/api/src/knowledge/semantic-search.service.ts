import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@docoo/config';
import {
  embedPendingChunks,
  embedQuery,
  selectChunksToEmbed,
  semanticSearchFromEnv,
  semanticStatus,
  storeChunkEmbeddings,
  type SemanticQuery,
  type SemanticSearch,
} from '@docoo/orchestration';

import { writeAudit } from '../common/audit.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { API_CONFIG } from '../tokens.js';

/** Tests replace the provider with a scripted one; production builds it from the environment. */
export const SEMANTIC_SEARCH = Symbol('SEMANTIC_SEARCH');

/** The provider the environment configures, or null when a lock is closed. */
export const semanticSearchProvider = {
  provide: SEMANTIC_SEARCH,
  useFactory: (config: Environment): SemanticSearch | null => semanticSearchFromEnv({ ...config }),
  inject: [API_CONFIG],
};

export type SemanticReason = 'not_enabled' | 'internal_not_allowed' | 'not_configured';

/**
 * Semantic search over knowledge (ADR-0060). It only ever works when the owner opened every lock in
 * the environment (`KNOWLEDGE_EMBEDDING_*`); otherwise each method answers "off" and retrieval is
 * what it was. Nothing here throws into a request: a provider failure is a missing ranking.
 */
@Injectable()
export class SemanticSearchService {
  private readonly search: SemanticSearch | null;

  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(API_CONFIG) private readonly config: Environment,
    @Inject(SEMANTIC_SEARCH) search: SemanticSearch | null,
  ) {
    this.search = search;
  }

  /** Why it is off, in words of the setting to change; null when it is on. */
  reason(): SemanticReason | null {
    if (this.search) return null;
    if (!this.config.KNOWLEDGE_EMBEDDING_ENABLED) return 'not_enabled';
    if (!this.config.KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL) return 'internal_not_allowed';
    return 'not_configured';
  }

  /** The vector of a question, or null when it is off, refused by the privacy check or failed. */
  queryVector(question: string): Promise<SemanticQuery | null> {
    return embedQuery(this.search, question);
  }

  async status(context: WorkspaceRequestContext) {
    const reason = this.reason();
    if (!this.search) {
      return {
        enabled: false as const,
        reason,
        model: null,
        eligible: 0,
        embedded: 0,
        keptLocal: 0,
      };
    }
    const status = await this.database.run(context, (client) =>
      semanticStatus(client, this.search!.model),
    );
    return { enabled: true as const, reason: null, ...status };
  }

  /**
   * Embeds up to `limit` chunks that have no vector yet. The provider is called between two short
   * transactions, never inside one. Only the counts are audited, never any text.
   */
  async run(context: WorkspaceRequestContext, limit: number) {
    const search = this.search;
    if (!search) return { enabled: false as const, reason: this.reason() };
    const pending = await this.database.run(context, (client) =>
      selectChunksToEmbed(client, search.model, limit),
    );
    const result = await embedPendingChunks({
      search,
      pending,
      store: (rows) =>
        this.database.run(context, (client) =>
          storeChunkEmbeddings(client, context.workspaceId, search.model, rows),
        ),
    });
    await this.database.run(context, (client) =>
      writeAudit(client, context, {
        action: 'knowledge.semantic_index',
        targetType: 'workspace',
        targetId: context.workspaceId,
        after: {
          model: search.model,
          asked: pending.length,
          embedded: result.embedded,
          failedBatches: result.failedBatches,
        },
      }),
    );
    return { enabled: true as const, reason: null, asked: pending.length, ...result };
  }
}
