import { checkSearchQuery } from '@docoo/domain';
import { createOpenAiEmbeddings } from '@docoo/providers';
import { chunkSearchInput, vectorLiteral } from '@docoo/knowledge';
import type { PoolClient } from 'pg';

/**
 * Semantic (provider) embeddings of knowledge (ADR-0061). The local hash embedding only compares
 * the shapes of letters and words; a provider's embedding model compares meaning, so "keeping
 * customers from leaving" finds a document about churn, and a Persian question finds an English
 * document. It is optional, off by default and held by the same locks the owner already set for
 * `KNOWLEDGE_EMBEDDING_*`:
 *
 * 1. nothing leaves unless `KNOWLEDGE_EMBEDDING_ENABLED` is true and a key and model are set;
 * 2. only chunks of `internal` knowledge are ever sent (`KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL`
 *    must be true as well; confidential and restricted knowledge is never embedded);
 * 3. a question is sent only after the privacy check of web search queries.
 *
 * Every failure leaves retrieval on the local embedding and the words; none is thrown.
 */

/** The length of a stored vector (the column is `vector(1536)`). */
export const SEMANTIC_DIMENSIONS = 1536;

/**
 * A semantic match counts only above this cosine similarity, so an unrelated chunk is not pulled in
 * just because it is the nearest of a few. Not tuned on real data yet: it is the first number to
 * revisit with the retrieval evaluation (`qa/retrieval-eval`) and a real key.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.25;

export interface SemanticConfig {
  readonly apiKey: string;
  readonly model: string;
}

export type Embedder = (texts: readonly string[]) => Promise<number[][]>;

export interface SemanticSearch {
  readonly model: string;
  readonly embed: Embedder;
}

/** The configuration when every lock is open, otherwise null. */
export function semanticConfigFrom(env: Readonly<Record<string, unknown>>): SemanticConfig | null {
  const on = (value: unknown) => value === true || value === 'true';
  if (!on(env['KNOWLEDGE_EMBEDDING_ENABLED']) || !on(env['KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL']))
    return null;
  const apiKey =
    typeof env['KNOWLEDGE_EMBEDDING_API_KEY'] === 'string'
      ? env['KNOWLEDGE_EMBEDDING_API_KEY'].trim()
      : '';
  const model =
    typeof env['KNOWLEDGE_EMBEDDING_MODEL'] === 'string'
      ? env['KNOWLEDGE_EMBEDDING_MODEL'].trim()
      : '';
  return apiKey && model ? { apiKey, model } : null;
}

/** The text-embedding-3 models can shorten their vector; the older one is 1536 long as it is. */
const shortensVectors = (model: string): boolean => model.startsWith('text-embedding-3');

export function openAiSemanticSearch(
  config: SemanticConfig,
  fetcher?: typeof fetch,
): SemanticSearch {
  return {
    model: config.model,
    embed: (texts) =>
      createOpenAiEmbeddings({
        apiKey: config.apiKey,
        model: config.model,
        texts,
        ...(shortensVectors(config.model) ? { dimensions: SEMANTIC_DIMENSIONS } : {}),
        ...(fetcher ? { fetcher } : {}),
      }),
  };
}

/** The search the process is configured for, or null when a lock is closed. */
export function semanticSearchFromEnv(
  env: Readonly<Record<string, unknown>>,
  fetcher?: typeof fetch,
): SemanticSearch | null {
  const config = semanticConfigFrom(env);
  return config ? openAiSemanticSearch(config, fetcher) : null;
}

/**
 * The semantic vector of a question for a process that has no injected search (the workers),
 * from its own environment. A worker has the four variables only when the owner put them in its
 * environment file (they are not passed on by default, so the key reaches no process unasked);
 * without them this is null at once and retrieval is unchanged.
 */
export function semanticQueryFromEnv(question: string): Promise<SemanticQuery | null> {
  return embedQuery(semanticSearchFromEnv(process.env), question);
}

export interface SemanticQuery {
  readonly model: string;
  readonly vector: readonly number[];
}

/**
 * The vector of a question, or null when there is no search, the question fails the privacy check
 * (an e-mail, a number, an internal address or a key in it), the provider fails, or its answer has
 * the wrong length. Never throws.
 */
export async function embedQuery(
  search: SemanticSearch | null,
  question: string,
): Promise<SemanticQuery | null> {
  if (!search) return null;
  const checked = checkSearchQuery(question);
  if (!checked.ok) return null;
  try {
    const [vector] = await search.embed([checked.query]);
    return vector && vector.length === SEMANTIC_DIMENSIONS ? { model: search.model, vector } : null;
  } catch {
    return null;
  }
}

export interface PendingChunk {
  readonly id: string;
  /** What is embedded: the context (title and heading) and the text, as the chunk is searched. */
  readonly text: string;
}

/**
 * Chunks still without a vector of `model`, oldest first. Only the current approved version of
 * `internal` knowledge counts: this is where the second lock is enforced, in the query itself.
 */
export async function selectChunksToEmbed(
  client: PoolClient,
  model: string,
  limit: number,
): Promise<PendingChunk[]> {
  const result = await client.query<{ id: string; text: string; context: string | null }>(
    `select ch.id, ch.text, ch.context
       from knowledge_chunks ch
       join knowledge_versions v on v.id = ch.knowledge_version_id
       join knowledge_items i on i.id = v.item_id and i.current_version_id = v.id
      where i.deleted_at is null and i.confidentiality = 'internal' and v.status = 'approved'
        and not exists (select 1 from knowledge_chunk_embeddings e where e.chunk_id = ch.id and e.model = $1)
      order by ch.created_at, ch.id
      limit $2`,
    [model, limit],
  );
  return result.rows.map((row) => ({ id: row.id, text: chunkSearchInput(row) }));
}

export async function storeChunkEmbeddings(
  client: PoolClient,
  workspaceId: string,
  model: string,
  rows: readonly { readonly id: string; readonly vector: readonly number[] }[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `insert into knowledge_chunk_embeddings (chunk_id, workspace_id, model, embedding)
       values ($1, $2, $3, $4::vector) on conflict (chunk_id, model) do nothing`,
      [row.id, workspaceId, model, vectorLiteral(row.vector)],
    );
  }
}

export interface SemanticStatus {
  readonly model: string;
  /** Chunks of internal, approved, current knowledge: the ones that may be embedded. */
  readonly eligible: number;
  readonly embedded: number;
  /** Chunks that stay local because their knowledge is not `internal`. */
  readonly keptLocal: number;
}

export async function semanticStatus(client: PoolClient, model: string): Promise<SemanticStatus> {
  const row = (
    await client.query<{ eligible: number; embedded: number; kept_local: number }>(
      `select count(*) filter (where i.confidentiality = 'internal')::int as eligible,
              count(*) filter (where i.confidentiality = 'internal'
                and exists (select 1 from knowledge_chunk_embeddings e where e.chunk_id = ch.id and e.model = $1))::int as embedded,
              count(*) filter (where i.confidentiality <> 'internal')::int as kept_local
         from knowledge_chunks ch
         join knowledge_versions v on v.id = ch.knowledge_version_id
         join knowledge_items i on i.id = v.item_id and i.current_version_id = v.id
        where i.deleted_at is null and v.status = 'approved'`,
      [model],
    )
  ).rows[0]!;
  return { model, eligible: row.eligible, embedded: row.embedded, keptLocal: row.kept_local };
}

const BATCH_TEXTS = 32;
const BATCH_BYTES = 120_000;
const MAX_TEXT_BYTES = 6_000;
const encoder = new TextEncoder();

/** Groups texts into requests the embeddings adapter accepts (count and size bounded). */
export function embeddingBatches(chunks: readonly PendingChunk[]): PendingChunk[][] {
  const batches: PendingChunk[][] = [];
  let current: PendingChunk[] = [];
  let bytes = 0;
  for (const chunk of chunks) {
    const size = encoder.encode(chunk.text).byteLength;
    // A text the adapter would refuse is left for a later pass rather than failing the batch.
    if (size === 0 || size > MAX_TEXT_BYTES) continue;
    if (current.length >= BATCH_TEXTS || bytes + size > BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(chunk);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface IndexResult {
  readonly embedded: number;
  readonly failedBatches: number;
}

/**
 * Embeds the chunks `pending` hands over and stores them. The caller runs `pending` and `store`
 * inside database transactions and this function between them, so no transaction is held open
 * while the provider answers. A failed batch is counted and skipped; the next run takes it again.
 */
export async function embedPendingChunks(input: {
  readonly search: SemanticSearch;
  readonly pending: readonly PendingChunk[];
  readonly store: (
    rows: readonly { readonly id: string; readonly vector: readonly number[] }[],
  ) => Promise<void>;
}): Promise<IndexResult> {
  let embedded = 0;
  let failedBatches = 0;
  for (const batch of embeddingBatches(input.pending)) {
    try {
      const vectors = await input.search.embed(batch.map((chunk) => chunk.text));
      const rows = batch.flatMap((chunk, index) => {
        const vector = vectors[index];
        return vector && vector.length === SEMANTIC_DIMENSIONS ? [{ id: chunk.id, vector }] : [];
      });
      if (rows.length < batch.length) failedBatches += 1;
      await input.store(rows);
      embedded += rows.length;
    } catch {
      failedBatches += 1;
    }
  }
  return { embedded, failedBatches };
}
