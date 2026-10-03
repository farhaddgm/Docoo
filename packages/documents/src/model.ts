/**
 * Structured document model (docs/04-architecture/05-document-pipeline.md §3). The JSON
 * blocks are the source of truth; DOCX, PDF and PPTX are renderings of a version.
 */
export interface Run {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** Citation ids this run cites; resolved against the bibliography. */
  readonly citations?: readonly string[];
}

export type Block =
  | {
      readonly type: 'heading';
      readonly id: string;
      readonly level: 1 | 2 | 3;
      readonly text: string;
    }
  | { readonly type: 'paragraph'; readonly id: string; readonly runs: readonly Run[] }
  | {
      readonly type: 'list';
      readonly id: string;
      readonly ordered: boolean;
      readonly items: readonly string[];
    }
  | {
      readonly type: 'table';
      readonly id: string;
      readonly caption: string;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
      readonly notes?: string;
    }
  | {
      readonly type: 'figure';
      readonly id: string;
      readonly assetRef: string;
      readonly caption: string;
      readonly alt: string;
    }
  | {
      readonly type: 'chart';
      readonly id: string;
      readonly kind: 'bar' | 'line';
      readonly title: string;
      readonly unit: string;
      readonly source: string;
      readonly alt: string;
      readonly labels: readonly string[];
      readonly values: readonly number[];
    }
  | {
      readonly type: 'callout';
      readonly id: string;
      readonly tone: 'info' | 'warning' | 'decision';
      readonly text: string;
    }
  | { readonly type: 'pageBreak'; readonly id: string }
  | {
      readonly type: 'appendix';
      readonly id: string;
      readonly title: string;
      readonly blocks: readonly Block[];
    }
  | {
      readonly type: 'bibliography';
      readonly id: string;
      readonly entries: readonly {
        readonly id: string;
        readonly text: string;
        readonly url?: string;
      }[];
    };

export interface StructuredDocument {
  readonly title: string;
  readonly language: 'fa' | 'en';
  readonly blocks: readonly Block[];
}

export class DocumentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

const BLOCK_TYPES = new Set([
  'heading',
  'paragraph',
  'list',
  'table',
  'figure',
  'chart',
  'callout',
  'pageBreak',
  'appendix',
  'bibliography',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Validates untrusted JSON as a structured document. Unknown block types fail validation
 * instead of being dropped silently (§3), and every block needs a unique id.
 */
export function validateDocument(input: unknown): StructuredDocument {
  const problems: string[] = [];
  if (!isRecord(input)) throw new DocumentValidationError(['document must be an object']);
  if (!str(input['title']) || !input['title'].trim()) problems.push('title is required');
  if (input['language'] !== 'fa' && input['language'] !== 'en')
    problems.push('language must be fa or en');
  if (!Array.isArray(input['blocks'])) problems.push('blocks must be an array');
  const ids = new Set<string>();
  const citationIds = new Set<string>();
  const cited = new Set<string>();

  const check = (block: unknown, path: string, depth: number): void => {
    if (!isRecord(block)) {
      problems.push(`${path} must be an object`);
      return;
    }
    const type = block['type'];
    if (!str(type) || !BLOCK_TYPES.has(type)) {
      problems.push(`${path}: unknown block type ${JSON.stringify(type)}`);
      return;
    }
    if (!str(block['id']) || !block['id']) problems.push(`${path}: id is required`);
    else if (ids.has(block['id'])) problems.push(`${path}: duplicate id ${block['id']}`);
    else ids.add(block['id']);
    switch (type) {
      case 'heading':
        if (![1, 2, 3].includes(block['level'] as number))
          problems.push(`${path}: heading level must be 1-3`);
        if (!str(block['text'])) problems.push(`${path}: heading text is required`);
        break;
      case 'paragraph':
        if (!Array.isArray(block['runs'])) problems.push(`${path}: runs must be an array`);
        else
          for (const [index, run] of block['runs'].entries()) {
            if (!isRecord(run) || !str(run['text']))
              problems.push(`${path}.runs[${index}]: text is required`);
            else if (Array.isArray(run['citations']))
              for (const id of run['citations']) if (str(id)) cited.add(id);
          }
        break;
      case 'list':
        if (!Array.isArray(block['items']) || !block['items'].every(str))
          problems.push(`${path}: items must be strings`);
        break;
      case 'table': {
        const columns = block['columns'];
        const rows = block['rows'];
        if (!Array.isArray(columns) || !columns.every(str) || columns.length === 0)
          problems.push(`${path}: columns are required`);
        else if (
          !Array.isArray(rows) ||
          !rows.every(
            (row) => Array.isArray(row) && row.length === columns.length && row.every(str),
          )
        ) {
          problems.push(`${path}: every row needs one text cell per column`);
        }
        if (!str(block['caption'])) problems.push(`${path}: caption is required`);
        break;
      }
      case 'figure':
        for (const field of ['assetRef', 'caption', 'alt'])
          if (!str(block[field]) || !block[field]) problems.push(`${path}: ${field} is required`);
        break;
      case 'chart': {
        for (const field of ['title', 'unit', 'source', 'alt'])
          if (!str(block[field]) || !block[field]) problems.push(`${path}: ${field} is required`);
        const labels = block['labels'];
        const values = block['values'];
        if (
          !Array.isArray(labels) ||
          !Array.isArray(values) ||
          labels.length === 0 ||
          labels.length !== values.length
        ) {
          problems.push(
            `${path}: a chart needs traceable data (labels and values of equal length)`,
          );
        } else if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          problems.push(`${path}: chart values must be numbers`);
        }
        if (block['kind'] !== 'bar' && block['kind'] !== 'line')
          problems.push(`${path}: chart kind must be bar or line`);
        break;
      }
      case 'callout':
        if (
          !['info', 'warning', 'decision'].includes(block['tone'] as string) ||
          !str(block['text'])
        )
          problems.push(`${path}: callout needs tone and text`);
        break;
      case 'appendix':
        if (!str(block['title'])) problems.push(`${path}: appendix title is required`);
        if (depth > 2) problems.push(`${path}: appendices nest at most two levels`);
        if (Array.isArray(block['blocks']))
          block['blocks'].forEach((child, index) =>
            check(child, `${path}.blocks[${index}]`, depth + 1),
          );
        else problems.push(`${path}: appendix blocks must be an array`);
        break;
      case 'bibliography':
        if (!Array.isArray(block['entries'])) problems.push(`${path}: entries must be an array`);
        else
          for (const [index, entry] of block['entries'].entries()) {
            if (!isRecord(entry) || !str(entry['id']) || !str(entry['text']))
              problems.push(`${path}.entries[${index}]: id and text are required`);
            else citationIds.add(entry['id']);
          }
        break;
      default:
        break;
    }
  };

  if (Array.isArray(input['blocks']))
    input['blocks'].forEach((block, index) => check(block, `blocks[${index}]`, 0));
  for (const id of cited)
    if (!citationIds.has(id)) problems.push(`citation ${id} is not in the bibliography`);
  if (problems.length > 0) throw new DocumentValidationError(problems);
  return input as unknown as StructuredDocument;
}

/** Walks every block, including appendix children, in reading order. */
export function* walkBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const block of blocks) {
    yield block;
    if (block.type === 'appendix') yield* walkBlocks(block.blocks);
  }
}
