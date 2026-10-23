import type { ReactNode } from 'react';
import { textDir, type Locale } from '../../../i18n';

/**
 * Text written in Contenter (a profile section, a note) is plain text with light Markdown habits:
 * `##` headings, `**bold**`, dash or numbered lists, and often one long run of sentences. This
 * turns it into blocks the page can lay out. It never produces HTML: every piece is a React node,
 * and only web addresses become links.
 */

export type Inline =
  { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'link'; text: string };

export type Block =
  | { type: 'heading'; level: 3 | 4 | 5; text: Inline[] }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'question'; question: Inline[]; answer: Inline[] };

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const BULLET = /^\s*(?:[-*•–—])\s+(.+)$/u;
const NUMBERED = /^\s*(?:\d{1,3}|[۰-۹]{1,3})\s*[.)]\s+(.+)$/u;
/** A sentence ends at . ! ? ؟ ؛ followed by a space; a decimal point inside a number does not. */
const SENTENCE_END = /(?<=[.!?؟؛])\s+/u;
const QUESTION_END = /[?؟]$/u;
const HEADING_TAGS = { 3: 'h3', 4: 'h4', 5: 'h5' } as const;
const LONG_PARAGRAPH = 240;
const CHUNK_TARGET = 150;

/** Splits `**bold**` and bare web addresses out of a line. */
export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?،؛؟»"'])/gu;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: 'text', text: line.slice(last, index) });
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: 'link', text: match[2] });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts.length > 0 ? parts : [{ kind: 'text', text: line }];
}

/** A long run of sentences becomes short paragraphs; a question starts its own block with its answer. */
function splitLong(text: string): Block[] {
  const sentences = text.split(SENTENCE_END).filter((sentence) => sentence.trim() !== '');
  if (sentences.length < 3) return [{ type: 'paragraph', text: parseInline(text) }];
  const questions = sentences.filter((sentence) => QUESTION_END.test(sentence.trim())).length;
  if (text.length < LONG_PARAGRAPH && questions < 2) {
    return [{ type: 'paragraph', text: parseInline(text) }];
  }
  if (questions >= 2) {
    const blocks: Block[] = [];
    const intro: string[] = [];
    let current: { question: string; answer: string[] } | null = null;
    const flush = () => {
      if (current) {
        blocks.push({
          type: 'question',
          question: parseInline(current.question),
          answer: parseInline(current.answer.join(' ')),
        });
        current = null;
      }
    };
    for (const sentence of sentences) {
      if (QUESTION_END.test(sentence.trim())) {
        flush();
        current = { question: sentence.trim(), answer: [] };
      } else if (current) {
        current.answer.push(sentence.trim());
      } else {
        intro.push(sentence.trim());
      }
    }
    flush();
    if (intro.length > 0) blocks.unshift({ type: 'paragraph', text: parseInline(intro.join(' ')) });
    return blocks;
  }
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    buffer.push(sentence.trim());
    length += sentence.length;
    if (length >= CHUNK_TARGET) {
      blocks.push({ type: 'paragraph', text: parseInline(buffer.join(' ')) });
      buffer = [];
      length = 0;
    }
  }
  if (buffer.length > 0) blocks.push({ type: 'paragraph', text: parseInline(buffer.join(' ')) });
  return blocks;
}

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const closeList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const raw of source.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      closeList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      closeList();
      const depth = Math.min((heading[1] ?? '#').length, 3);
      blocks.push({
        type: 'heading',
        level: (depth + 2) as 3 | 4 | 5,
        text: parseInline(heading[2] ?? ''),
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) closeList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(item.trim()));
      continue;
    }
    closeList();
    blocks.push(...splitLong(line.trim()));
  }
  closeList();
  return blocks;
}

export function InlineText({ parts }: { readonly parts: readonly Inline[] }): ReactNode {
  return parts.map((part, index) => {
    if (part.kind === 'bold') return <strong key={index}>{part.text}</strong>;
    if (part.kind === 'link') {
      return (
        <a key={index} href={part.text} target="_blank" rel="noopener noreferrer" dir="ltr">
          {part.text}
        </a>
      );
    }
    return <span key={index}>{part.text}</span>;
  });
}

/** The laid-out text of one section or note. */
export function RichText({
  locale,
  text,
  className,
}: {
  readonly locale: Locale;
  readonly text: string;
  readonly className?: string;
}) {
  const blocks = parseRichText(text);
  return (
    <div className={className ? `rich ${className}` : 'rich'} dir={textDir(locale)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const Tag = HEADING_TAGS[block.level];
            return (
              <Tag key={index} className="rich-heading" dir={textDir(locale)}>
                <InlineText parts={block.text} />
              </Tag>
            );
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={index} className="rich-list" dir={textDir(locale)}>
                {block.items.map((item, position) => (
                  <li key={position}>
                    <InlineText parts={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'question':
            return (
              <div key={index} className="rich-qa" dir={textDir(locale)}>
                <p className="rich-question">
                  <InlineText parts={block.question} />
                </p>
                {block.answer.length > 0 && (
                  <p>
                    <InlineText parts={block.answer} />
                  </p>
                )}
              </div>
            );
          default:
            return (
              <p key={index} dir={textDir(locale)}>
                <InlineText parts={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
