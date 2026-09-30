// Markdown → Notion block conversion for the documentation subset used in docs/**.
// Supported: headings, paragraphs, bulleted/numbered lists (two levels), fenced code,
// GFM tables, blockquotes, horizontal rules and inline bold/italic/code/links.

const MAX_TEXT = 2000;

const CODE_LANGUAGES = {
  '': 'plain text',
  text: 'plain text',
  txt: 'plain text',
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  bash: 'bash',
  sh: 'shell',
  shell: 'shell',
  mermaid: 'mermaid',
  html: 'html',
  css: 'css',
  markdown: 'markdown',
  md: 'markdown',
};

export function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: content };
  const data = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (field) data[field[1]] = field[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { data, body: content.slice(match[0].length) };
}

function textItem(content, annotations, url) {
  const item = { type: 'text', text: { content } };
  if (url) item.text.link = { url };
  const active = Object.fromEntries(Object.entries(annotations).filter(([, on]) => on));
  if (Object.keys(active).length > 0) item.annotations = active;
  return item;
}

function pushText(items, content, annotations, url) {
  for (let i = 0; i < content.length; i += MAX_TEXT) {
    items.push(textItem(content.slice(i, i + MAX_TEXT), annotations, url));
  }
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\[[^\]]+\]\([^)\s]+\))|((?<![\w*])\*[^*\s-][^*]*?\*(?![\w*]))/g;

export function richText(source, resolveLink = (href) => href, base = {}) {
  const items = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) pushText(items, source.slice(last, match.index), base);
    const [token] = match;
    if (match[1]) {
      pushText(items, token.slice(1, -1), { ...base, code: true });
    } else if (match[2]) {
      items.push(...richText(token.slice(2, -2), resolveLink, { ...base, bold: true }));
    } else if (match[3]) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const url = resolveLink(href);
      for (const item of richText(label, resolveLink, base)) {
        if (url && !item.text.link) item.text.link = { url };
        items.push(item);
      }
    } else {
      items.push(...richText(token.slice(1, -1), resolveLink, { ...base, italic: true }));
    }
    last = match.index + token.length;
  }
  if (last < source.length) pushText(items, source.slice(last), base);
  return items;
}

function block(type, payload) {
  return { object: 'block', type, [type]: payload };
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const TABLE_DELIMITER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function markdownToBlocks(markdown, { resolveLink } = {}) {
  const rt = (text) => richText(text, resolveLink);
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(block('paragraph', { rich_text: rt(paragraph.join(' ')) }));
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    const fence = trimmed.match(/^(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      flushParagraph();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const language = CODE_LANGUAGES[fence[2].toLowerCase()] ?? 'plain text';
      const rich_text = [];
      pushText(rich_text, code.join('\n'), {});
      blocks.push(block('code', { rich_text, language }));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 3);
      blocks.push(block(`heading_${level}`, { rich_text: rt(heading[2].trim()) }));
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push(block('divider', {}));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('|') && TABLE_DELIMITER.test(lines[i + 1]?.trim() ?? '')) {
      flushParagraph();
      const header = splitRow(trimmed);
      const rows = [header];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const width = header.length;
      blocks.push(
        block('table', {
          table_width: width,
          has_column_header: true,
          has_row_header: false,
          children: rows.map((row) =>
            block('table_row', {
              cells: Array.from({ length: width }, (_, index) => rt(row[index] ?? '')),
            }),
          ),
        }),
      );
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(block('quote', { rich_text: rt(quote.join(' ')) }));
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      flushParagraph();
      const baseIndent = item[1].length;
      let parent = null;
      while (i < lines.length) {
        const current = lines[i].match(LIST_ITEM);
        if (!current) {
          // Continuation line of the previous item (indented, non-empty).
          if (lines[i].trim() !== '' && /^\s+/.test(lines[i]) && parent) {
            const target = parent.lastChild ?? parent.block;
            const payload = target[target.type];
            payload.rich_text.push(...rt(` ${lines[i].trim()}`));
            i += 1;
            continue;
          }
          break;
        }
        const type = /^\d/.test(current[2]) ? 'numbered_list_item' : 'bulleted_list_item';
        const entry = block(type, { rich_text: rt(current[3]) });
        if (current[1].length > baseIndent && parent) {
          // Notion accepts two nesting levels per request; deeper items are flattened.
          parent.block[parent.block.type].children ??= [];
          parent.block[parent.block.type].children.push(entry);
          parent.lastChild = entry;
        } else {
          blocks.push(entry);
          parent = { block: entry, lastChild: null };
        }
        i += 1;
      }
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }
  flushParagraph();
  return blocks;
}
