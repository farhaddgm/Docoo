import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
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

/**
 * Whether newly approved knowledge is embedded by itself, and how long after the approval (so the
 * approving transaction has committed). Tests replace it.
 */
export const SEMANTIC_AUTO_INDEX = Symbol('SEMANTIC_AUTO_INDEX');
export interface SemanticAutoIndex {
  readonly enabled: boolean;
  readonly delayMs: number;
}
export const semanticAutoIndexProvider = {
  provide: SEMANTIC_AUTO_INDEX,
  useValue: { enabled: true, delayMs: 2_000 } satisfies SemanticAutoIndex,
};

/** The most chunks one automatic run embeds, and how many runs follow each other for a backlog. */
const AUTO_RUN_LIMIT = 200;
const AUTO_RUN_PASSES = 5;

export type SemanticReason = 'not_enabled' | 'internal_not_allowed' | 'not_configured';

/**
 * Semantic search over knowledge (ADR-0061). It only ever works when the owner opened every lock in
 * the environment (`KNOWLEDGE_EMBEDDING_*`); otherwise each method answers "off" and retrieval is
 * what it was. Nothing here throws into a request: a provider failure is a missing ranking.
 */
@Injectable()
export class SemanticSearchService implements OnModuleDestroy {
  private readonly search: SemanticSearch | null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();

  constructor(
    private readonly database: WorkspaceDatabase,
    @Inject(API_CONFIG) private readonly config: Environment,
    @Inject(SEMANTIC_SEARCH) search: SemanticSearch | null,
    @Inject(SEMANTIC_AUTO_INDEX) private readonly auto: SemanticAutoIndex,
  ) {
    this.search = search;
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Embeds what has just been approved, a moment later and in the background. It does nothing when
   * semantic search is off. Runs are coalesced per workspace (many approvals in a row make one run)
   * and never overlap; a run only takes chunks that are committed and still without a vector, so a
   * run that comes before a commit is harmless and the next approval or the button catches up.
   * A failure is a missing vector, never an error: the caller has long since answered.
   */
  indexSoon(context: WorkspaceRequestContext): void {
    if (!this.search || !this.auto.enabled) return;
    const key = context.workspaceId;
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.runInBackground(context);
    }, this.auto.delayMs);
    timer.unref();
    this.timers.set(key, timer);
  }

  private async runInBackground(context: WorkspaceRequestContext): Promise<void> {
    const key = context.workspaceId;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      for (let pass = 0; pass < AUTO_RUN_PASSES; pass += 1) {
        const result = await this.run(context, AUTO_RUN_LIMIT, 'auto');
        if (!result.enabled || !('asked' in result) || result.asked === 0 || result.embedded === 0)
          break;
      }
    } catch {
      // The next approval, or the button, tries again.
    } finally {
      this.running.delete(key);
    }
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
  async run(
    context: WorkspaceRequestContext,
    limit: number,
    trigger: 'manual' | 'auto' = 'manual',
  ) {
    const search = this.search;
    if (!search) return { enabled: false as const, reason: this.reason() };
    const scan = await this.database.run(context, (client) =>
      selectChunksToEmbed(client, search.model, limit),
    );
    const pending = scan.chunks;
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
          heldBack: scan.heldBack,
          trigger,
        },
      }),
    );
    return {
      enabled: true as const,
      reason: null,
      asked: pending.length,
      heldBack: scan.heldBack,
      ...result,
    };
  }
}
