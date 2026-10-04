import type { ReactNode } from 'react';

import { formatNumber, type Locale } from '../../../i18n';
import { documentMessages } from './document-messages';

/** Shape of the structured document model of `@docoo/documents`, as the API sends it. */
export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  citations?: string[];
}

export type DocBlock =
  | { type: 'heading'; id: string; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; id: string; runs: DocRun[] }
  | { type: 'list'; id: string; ordered: boolean; items: string[] }
  | {
      type: 'table';
      id: string;
      caption: string;
      columns: string[];
      rows: string[][];
      notes?: string;
    }
  | { type: 'figure'; id: string; assetRef: string; caption: string; alt: string }
  | {
      type: 'chart';
      id: string;
      kind: 'bar' | 'line';
      title: string;
      unit: string;
      source: string;
      alt: string;
      labels: string[];
      values: number[];
    }
  | { type: 'callout'; id: string; tone: 'info' | 'warning' | 'decision'; text: string }
  | { type: 'pageBreak'; id: string }
  | { type: 'appendix'; id: string; title: string; blocks: DocBlock[] }
  | { type: 'bibliography'; id: string; entries: { id: string; text: string; url?: string }[] };

export interface DocContent {
  title: string;
  language: 'fa' | 'en';
  blocks: DocBlock[];
}

/** Read-only view of a document version; the content itself is never changed here. */
export function DocumentContent({
  locale,
  content,
}: {
  locale: Locale;
  content: DocContent;
}): ReactNode {
  return (
    <div
      className="document-view"
      lang={content.language}
      dir={content.language === 'fa' ? 'rtl' : 'ltr'}
    >
      <h3 className="document-title">{content.title}</h3>
      {content.blocks.map((block) => (
        <Block key={block.id} locale={locale} block={block} depth={0} />
      ))}
    </div>
  );
}

function Block({ locale, block, depth }: { locale: Locale; block: DocBlock; depth: number }) {
  const text = documentMessages(locale);
  switch (block.type) {
    case 'heading': {
      // The page already uses h1-h3; document headings start below them.
      const Tag = (['h4', 'h5', 'h6'] as const)[
        Math.min(2, block.level - 1 + (depth > 0 ? 1 : 0))
      ]!;
      return <Tag>{block.text}</Tag>;
    }
    case 'paragraph':
      return (
        <p>
          {block.runs.map((run, index) => {
            let node: ReactNode = run.text;
            if (run.bold) node = <strong>{node}</strong>;
            if (run.italic) node = <em>{node}</em>;
            return (
              <span key={index}>
                {node}
                {run.citations && run.citations.length > 0 && (
                  <sup aria-label={text.citations}>[{run.citations.join(', ')}]</sup>
                )}
              </span>
            );
          })}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={block.caption}>
          <table>
            <caption>{block.caption}</caption>
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.notes && <p className="muted">{block.notes}</p>}
        </div>
      );
    case 'figure':
      return (
        <figure>
          <figcaption>{block.caption}</figcaption>
          <p className="muted">{block.alt}</p>
        </figure>
      );
    case 'chart':
      return (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={block.title}>
          <table>
            <caption>
              {block.title} ({block.unit}) — {block.source}
            </caption>
            <tbody>
              {block.labels.map((label, index) => (
                <tr key={index}>
                  <th scope="row">{label}</th>
                  <td>{formatNumber(locale, block.values[index] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout':
      return (
        <p className={`notice ${block.tone === 'warning' ? 'error' : 'ok'}`}>
          <strong>{text.callout[block.tone]}:</strong> {block.text}
        </p>
      );
    case 'pageBreak':
      return <hr />;
    case 'appendix':
      return (
        <section>
          <h4>{block.title}</h4>
          {block.blocks.map((child) => (
            <Block key={child.id} locale={locale} block={child} depth={depth + 1} />
          ))}
        </section>
      );
    case 'bibliography':
      return (
        <ol className="output-list">
          {block.entries.map((entry) => (
            <li key={entry.id}>
              <span dir="auto">{entry.text}</span>
              {entry.url && (
                <>
                  {' '}
                  <span dir="ltr" className="muted">
                    {entry.url}
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      );
  }
}
