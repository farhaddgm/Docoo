import { normalizeExtractedText, type SegmentLocator } from '@docoo/knowledge';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

import { checkArchive } from './archive.js';
import { SUPPORTED_TYPES } from './mime.js';

export interface ExtractedSegment {
  readonly locator: SegmentLocator;
  readonly text: string;
  readonly confidence?: number;
}

export interface Extraction {
  readonly segments: ExtractedSegment[];
  /** Pages with too little text layer: they need OCR (1-based). */
  readonly pagesNeedingOcr: number[];
  readonly pageCount?: number;
  readonly truncated: boolean;
  readonly warnings: string[];
}

export const MAX_SEGMENTS = 20_000;
const MIN_PAGE_TEXT = 20;

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  // External entities and DTDs are never resolved by fast-xml-parser.
});

function parseXml(bytes: Uint8Array | undefined): XmlNode[] {
  if (!bytes) return [];
  return parser.parse(new TextDecoder().decode(bytes)) as XmlNode[];
}

function tagOf(node: XmlNode): string | null {
  return Object.keys(node).find((key) => key !== ':@') ?? null;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function attr(node: XmlNode, name: string): string | undefined {
  const attributes = node[':@'] as Record<string, string> | undefined;
  return attributes?.[name];
}

function* descendants(nodes: XmlNode[], tag: string): Generator<XmlNode> {
  for (const node of nodes) {
    if (tagOf(node) === tag) yield node;
    yield* descendants(childrenOf(node), tag);
  }
}

/** Concatenated text of the given text-run tag (w:t, a:t, t) below the nodes. */
function textOf(nodes: XmlNode[], textTag: string): string {
  let text = '';
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === '#text') continue;
    if (tag === textTag) {
      for (const child of childrenOf(node)) {
        if (typeof child['#text'] === 'string' || typeof child['#text'] === 'number') {
          text += String(child['#text']);
        }
      }
    } else if (tag === 'w:tab' || tag === 'a:tab') {
      text += '\t';
    } else if (tag === 'w:br' || tag === 'a:br') {
      text += '\n';
    } else {
      text += textOf(childrenOf(node), textTag);
    }
  }
  return text;
}

class SegmentSink {
  readonly segments: ExtractedSegment[] = [];
  truncated = false;

  push(locator: SegmentLocator, raw: string, confidence?: number): void {
    const text = normalizeExtractedText(raw);
    if (!text) return;
    if (this.segments.length >= MAX_SEGMENTS) {
      this.truncated = true;
      return;
    }
    this.segments.push(
      confidence === undefined ? { locator, text } : { locator, text, confidence },
    );
  }
}

function unzipChecked(bytes: Uint8Array): Record<string, Uint8Array> {
  const archive = checkArchive(bytes);
  if (!archive.ok) throw new ExtractionError(`archive_${archive.problem}`);
  return unzipSync(bytes);
}

export class ExtractionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function extractDocx(bytes: Uint8Array): Extraction {
  const files = unzipChecked(bytes);
  const document = parseXml(files['word/document.xml']);
  const sink = new SegmentSink();
  const body = [...descendants(document, 'w:body')][0];
  let paragraph = 0;
  let table = 0;
  for (const node of body ? childrenOf(body) : []) {
    const tag = tagOf(node);
    if (tag === 'w:p') {
      paragraph += 1;
      const style = [...descendants(childrenOf(node), 'w:pStyle')][0];
      const styleName = style ? attr(style, 'w:val') : undefined;
      sink.push(
        styleName ? { paragraph, style: styleName } : { paragraph },
        textOf(childrenOf(node), 'w:t'),
      );
    } else if (tag === 'w:tbl') {
      table += 1;
      let row = 0;
      for (const tr of descendants(childrenOf(node), 'w:tr')) {
        row += 1;
        const cells = [...descendants(childrenOf(tr), 'w:tc')].map((cell) =>
          textOf(childrenOf(cell), 'w:t').trim(),
        );
        sink.push({ table, row }, cells.join(' | '));
      }
    }
  }
  for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
    let note = 0;
    for (const footnote of descendants(
      parseXml(files[name]),
      name.includes('foot') ? 'w:footnote' : 'w:endnote',
    )) {
      note += 1;
      sink.push(
        { [name.includes('foot') ? 'footnote' : 'endnote']: note },
        textOf(childrenOf(footnote), 'w:t'),
      );
    }
  }
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

function numbered(files: Record<string, Uint8Array>, pattern: RegExp): [number, Uint8Array][] {
  return Object.entries(files)
    .map(([name, data]) => [Number(pattern.exec(name)?.[1] ?? NaN), data] as [number, Uint8Array])
    .filter(([index]) => Number.isInteger(index))
    .sort(([a], [b]) => a - b);
}

export function extractPptx(bytes: Uint8Array): Extraction {
  const files = unzipChecked(bytes);
  const sink = new SegmentSink();
  for (const [slide, data] of numbered(files, /^ppt\/slides\/slide(\d+)\.xml$/u)) {
    let paragraph = 0;
    for (const p of descendants(parseXml(data), 'a:p')) {
      paragraph += 1;
      sink.push({ slide, paragraph }, textOf(childrenOf(p), 'a:t'));
    }
  }
  for (const [slide, data] of numbered(files, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/u)) {
    const text = [...descendants(parseXml(data), 'a:p')]
      .map((p) => textOf(childrenOf(p), 'a:t'))
      .filter((line) => line.trim() && !/^\d+$/u.test(line.trim()))
      .join('\n');
    sink.push({ slide, notes: 1 }, text);
  }
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/\d+$/u, '')) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

export function extractXlsx(bytes: Uint8Array): Extraction {
  const files = unzipChecked(bytes);
  const sink = new SegmentSink();
  const shared = [...descendants(parseXml(files['xl/sharedStrings.xml']), 'si')].map((si) =>
    textOf(childrenOf(si), 't'),
  );
  const relationships = new Map<string, string>();
  for (const rel of descendants(parseXml(files['xl/_rels/workbook.xml.rels']), 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) relationships.set(id, target.replace(/^\/?(xl\/)?/u, 'xl/'));
  }
  for (const sheet of descendants(parseXml(files['xl/workbook.xml']), 'sheet')) {
    const name = attr(sheet, 'name') ?? 'Sheet';
    const path = relationships.get(attr(sheet, 'r:id') ?? '');
    if (!path) continue;
    for (const row of descendants(parseXml(files[path]), 'row')) {
      const cells: { ref: string; value: string }[] = [];
      for (const cell of descendants(childrenOf(row), 'c')) {
        const ref = attr(cell, 'r') ?? '';
        const type = attr(cell, 't');
        let value: string;
        if (type === 'inlineStr') {
          value = textOf(childrenOf(cell), 't');
        } else {
          const raw = textOf(childrenOf(cell), 'v');
          value =
            type === 's'
              ? (shared[Number(raw)] ?? '')
              : type === 'b'
                ? raw === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : raw;
        }
        if (value.trim()) cells.push({ ref, value: value.trim() });
      }
      if (cells.length === 0) continue;
      cells.sort((a, b) => columnIndex(a.ref) - columnIndex(b.ref));
      const range = cells.length === 1 ? cells[0]!.ref : `${cells[0]!.ref}:${cells.at(-1)!.ref}`;
      sink.push(
        { sheet: name, row: Number(attr(row, 'r') ?? 0), range },
        cells.map((cell) => cell.value).join(' | '),
      );
    }
  }
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

/** RFC 4180 rows; quoted fields may contain separators, quotes and line breaks. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const rows: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      fields.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      fields.push(field);
      if (fields.some((value) => value.trim())) rows.push({ line: rowLine, fields });
      fields = [];
      field = '';
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
  }
  fields.push(field);
  if (fields.some((value) => value.trim())) rows.push({ line: rowLine, fields });
  return rows;
}

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function extractCsv(bytes: Uint8Array): Extraction {
  const sink = new SegmentSink();
  const rows = parseCsv(decodeText(bytes));
  const header = rows[0]?.fields.map((value) => value.trim());
  for (const [index, row] of rows.entries()) {
    const text =
      index > 0 && header && header.length === row.fields.length
        ? row.fields.map((value, column) => `${header[column]}: ${value.trim()}`).join(' | ')
        : row.fields.map((value) => value.trim()).join(' | ');
    sink.push({ line: row.line, row: index + 1 }, text);
  }
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

/** Paragraphs separated by blank lines, located by their first line. */
export function extractPlainText(bytes: Uint8Array): Extraction {
  const sink = new SegmentSink();
  const lines = decodeText(bytes).split(/\r?\n/u);
  let buffer: string[] = [];
  let start = 1;
  const flush = (): void => {
    if (buffer.length > 0) sink.push({ line: start }, buffer.join('\n'));
    buffer = [];
  };
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      flush();
      start = index + 2;
    } else {
      if (buffer.length === 0) start = index + 1;
      buffer.push(line);
    }
  }
  flush();
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

export function extractJson(bytes: Uint8Array): Extraction {
  const sink = new SegmentSink();
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 64) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        visit(item, path ? `${path}.${key}` : key, depth + 1);
      }
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      const text = String(value);
      if (text.trim()) sink.push({ path: path || '$' }, `${path || '$'}: ${text}`);
    }
  };
  visit(JSON.parse(decodeText(bytes)) as unknown, '', 0);
  return { segments: sink.segments, pagesNeedingOcr: [], truncated: sink.truncated, warnings: [] };
}

export async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const document = await loading.promise;
  const sink = new SegmentSink();
  const pagesNeedingOcr: number[] = [];
  try {
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      }
      if (text.replace(/\s/gu, '').length < MIN_PAGE_TEXT) pagesNeedingOcr.push(page);
      else sink.push({ page }, text);
    }
    return {
      segments: sink.segments,
      pagesNeedingOcr,
      pageCount: document.numPages,
      truncated: sink.truncated,
      warnings: [],
    };
  } finally {
    await loading.destroy();
  }
}

/** Text-layer extraction for every structured type; images and audio go to OCR/ASR. */
export async function extractStructured(bytes: Uint8Array, mime: string): Promise<Extraction> {
  switch (mime) {
    case SUPPORTED_TYPES.pdf:
      return extractPdf(bytes);
    case SUPPORTED_TYPES.docx:
      return extractDocx(bytes);
    case SUPPORTED_TYPES.pptx:
      return extractPptx(bytes);
    case SUPPORTED_TYPES.xlsx:
      return extractXlsx(bytes);
    case SUPPORTED_TYPES.csv:
      return extractCsv(bytes);
    case SUPPORTED_TYPES.json:
      return extractJson(bytes);
    case SUPPORTED_TYPES.txt:
    case SUPPORTED_TYPES.md:
      return extractPlainText(bytes);
    default:
      throw new ExtractionError('unsupported_type');
  }
}
