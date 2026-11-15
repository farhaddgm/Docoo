import { normalizeForSearch, tokenize } from './normalize.js';
import { sentenceRanges } from './claims.js';

/**
 * `hash-ngram-v1`: a deterministic, local embedding — signed feature hashing of word
 * unigrams/bigrams and character trigrams into 256 dimensions, L2-normalised. It needs no
 * provider and gives the same vector everywhere, so retrieval is reproducible in CI. A
 * provider embedding model can replace it later under a new model id (KNO-007).
 */
export const EMBEDDING_MODEL = 'hash-ngram-v1';
export const EMBEDDING_DIMENSIONS = 256;

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function addFeature(vector: Float64Array, feature: string, weight: number): void {
  const hash = fnv1a(feature);
  const index = hash % EMBEDDING_DIMENSIONS;
  vector[index] = (vector[index] ?? 0) + ((hash >>> 31) & 1 ? -weight : weight);
}

export function embed(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  const words = tokenize(text);
  for (const [index, word] of words.entries()) {
    addFeature(vector, `w:${word}`, 1);
    const next = words[index + 1];
    if (next) addFeature(vector, `b:${word} ${next}`, 0.5);
    const padded = ` ${word} `;
    for (let start = 0; start + 3 <= padded.length; start += 1) {
      addFeature(vector, `c:${padded.slice(start, start + 3)}`, 0.25);
    }
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  return Array.from(vector, (value) => (norm === 0 ? 0 : Number((value / norm).toFixed(6))));
}

/** pgvector text literal. */
export function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index]! * b[index]!;
  }
  return dot;
}

/** Lexical query for to_tsquery('simple', ...): OR of normalised words. */
export function lexicalQuery(text: string): string | null {
  const words = [...new Set(tokenize(text))].filter((word) => word.length > 1).slice(0, 32);
  return words.length === 0
    ? null
    : words.map((word) => `'${word.replace(/'/gu, '')}'`).join(' | ');
}

export interface Chunk {
  readonly ordinal: number;
  readonly text: string;
}

/** Splits content into chunks of whole sentences of about `target` characters. */
export function chunkText(content: string, target = 800): Chunk[] {
  const chunks: Chunk[] = [];
  let current = '';
  const flush = (): void => {
    const text = current.trim();
    if (text) chunks.push({ ordinal: chunks.length + 1, text });
    current = '';
  };
  for (const range of sentenceRanges(content)) {
    const sentence = content.slice(range.start, range.end);
    if (current && current.length + sentence.length + 1 > target) flush();
    if (sentence.length > target) {
      for (let start = 0; start < sentence.length; start += target) {
        current = sentence.slice(start, start + target);
        flush();
      }
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return chunks;
}

export interface SectionChunk extends Chunk {
  /** The title of the document and the heading of the section the chunk is in; searched with it. */
  readonly context: string;
}

const MAX_HEADING_CHARS = 300;

/**
 * The text of a markdown heading line (`## Costs`, optionally closed with `##`), or null when the
 * line is not one. Read with plain string steps: a line of any length costs a single pass.
 */
function headingText(line: string): string | null {
  const text = line.length > 2000 ? line.slice(0, 2000) : line;
  let index = 0;
  while (index < 3 && (text[index] === ' ' || text[index] === '\t')) index += 1;
  let hashes = 0;
  while (text[index + hashes] === '#') hashes += 1;
  if (hashes < 1 || hashes > 6) return null;
  const after = index + hashes;
  if (text[after] !== ' ' && text[after] !== '\t') return null;
  let end = text.length;
  while (end > after && (text[end - 1] === ' ' || text[end - 1] === '\t' || text[end - 1] === '#'))
    end -= 1;
  const heading = text.slice(after, end).trim();
  return heading === '' ? null : heading.slice(0, MAX_HEADING_CHARS);
}
const CONTEXT_MAX = 300;

/**
 * Chunks a document by its sections. A markdown heading (`## Costs`) starts a section; the heading
 * is not part of the chunk text (a quote is checked against the text) but of its `context`, which
 * also names the document. A document without headings is one section. Within a section the
 * sentences are grouped as `chunkText` does, and the ordinals run on across sections.
 */
export function chunkSections(content: string, title: string, target = 800): SectionChunk[] {
  const sections: { heading: string; body: string[] }[] = [{ heading: '', body: [] }];
  for (const line of content.split(/\r?\n/u)) {
    const heading = headingText(line);
    if (heading !== null) sections.push({ heading, body: [] });
    else sections[sections.length - 1]!.body.push(line);
  }
  const chunks: SectionChunk[] = [];
  for (const section of sections) {
    const context = [title.trim(), section.heading]
      .filter((part) => part !== '')
      .join(' — ')
      .slice(0, CONTEXT_MAX);
    for (const chunk of chunkText(section.body.join('\n'), target)) {
      chunks.push({ ordinal: chunks.length + 1, text: chunk.text, context });
    }
  }
  return chunks;
}

/** What a chunk is searched and embedded as: its context, then its text. */
export const chunkSearchInput = (chunk: { text: string; context?: string | null }): string =>
  chunk.context ? `${chunk.context}\n${chunk.text}` : chunk.text;

/** Search form stored next to chunks so Persian letter variants match. */
export function searchText(text: string): string {
  return normalizeForSearch(text);
}
