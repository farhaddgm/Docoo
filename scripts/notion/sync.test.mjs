import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createNotionClient } from './client.mjs';
import { markdownToBlocks, richText } from './markdown.mjs';
import { syncDocs } from './sync.mjs';

test('richText converts inline markdown and splits long text', () => {
  const items = richText('a **b** `c` [d](x.md) *e*', (href) => `https://r/${href}`);
  assert.deepEqual(
    items.map((item) => [item.text.content, item.annotations ?? {}, item.text.link?.url]),
    [
      ['a ', {}, undefined],
      ['b', { bold: true }, undefined],
      [' ', {}, undefined],
      ['c', { code: true }, undefined],
      [' ', {}, undefined],
      ['d', {}, 'https://r/x.md'],
      [' ', {}, undefined],
      ['e', { italic: true }, undefined],
    ],
  );
  assert.equal(richText('x'.repeat(4500)).length, 3);
  assert.equal(richText('doc_id -> notion_page_id').length, 1);
});

test('markdownToBlocks covers the documentation subset', () => {
  const blocks = markdownToBlocks(
    [
      '# Title',
      '',
      'line one',
      'line two',
      '',
      '- item',
      '  - nested',
      '    continued',
      '1. first',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | `x\\|y` |',
      '',
      '> quote',
      '',
      '---',
      '#### deep',
    ].join('\n'),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    [
      'heading_1',
      'paragraph',
      'bulleted_list_item',
      'numbered_list_item',
      'code',
      'table',
      'quote',
      'divider',
      'heading_3',
    ],
  );
  assert.equal(blocks[1].paragraph.rich_text[0].text.content, 'line one line two');
  const nested = blocks[2].bulleted_list_item.children[0].bulleted_list_item.rich_text;
  assert.equal(nested.map((item) => item.text.content).join(''), 'nested continued');
  assert.equal(blocks[4].code.language, 'typescript');
  assert.equal(blocks[5].table.table_width, 2);
  assert.equal(blocks[5].table.children[1].table_row.cells[1][0].text.content, 'x|y');
});

function fakeNotion() {
  let counter = 0;
  const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const pages = new Map();
  const children = new Map();
  const calls = [];
  const schema = {
    Name: { type: 'title' },
    'Doc ID': { type: 'rich_text' },
    Version: { type: 'rich_text' },
    Status: { type: 'select' },
    'Commit SHA': { type: 'rich_text' },
    'Last Synced': { type: 'date' },
  };
  const addChildren = (parent, blocks) =>
    blocks.map((block) => {
      const created = { ...block, id: id() };
      children.set(parent, [...(children.get(parent) ?? []), created]);
      const nested = block[block.type]?.children;
      if (nested) addChildren(created.id, nested);
      return created;
    });

  const fetchImpl = async (url, init) => {
    const route = `${init.method} ${new URL(url).pathname.replace('/v1', '')}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push([route, body]);
    const json = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { 'retry-after': '0' } });
    let match;
    if ((match = route.match(/^GET \/data_sources\/(.+)$/))) return json({ properties: schema });
    if ((match = route.match(/^POST \/data_sources\/(.+)\/query$/))) return json({ results: [] });
    if (route === 'POST /pages') {
      const page = { id: id(), ...body };
      pages.set(page.id, page);
      if (body.parent.page_id) {
        const title = body.properties.title.title[0].text.content;
        addChildren(body.parent.page_id, [{ type: 'child_page', child_page: { title } }]);
      }
      return json(page);
    }
    if ((match = route.match(/^PATCH \/pages\/(.+)$/))) {
      const page = pages.get(match[1]) ?? { id: match[1] };
      page.properties = { ...page.properties, ...body.properties };
      pages.set(match[1], page);
      return json(page);
    }
    if ((match = route.match(/^GET \/blocks\/(.+)\/children$/))) {
      return json({ results: children.get(match[1]) ?? [], has_more: false });
    }
    if ((match = route.match(/^PATCH \/blocks\/(.+)\/children$/))) {
      if (body.children.length > 100) return json({ message: 'too many' }, 400);
      return json({ results: addChildren(match[1], body.children) });
    }
    if ((match = route.match(/^DELETE \/blocks\/(.+)$/))) {
      for (const [parent, list] of children) {
        children.set(
          parent,
          list.filter((block) => block.id !== match[1]),
        );
      }
      return json({});
    }
    return json({ message: `unhandled ${route}` }, 404);
  };
  return { fetchImpl, pages, children, calls };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notion-sync-'));
  await fs.mkdir(path.join(root, 'docs/_meta'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs/adr'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'docs/_meta/notion-manifest.yaml'),
    [
      'documents:',
      '  - path: docs/a.md',
      '    doc_id: DOC-A',
      '    section: Root',
      '  - path: docs/adr/b.md',
      '    doc_id: DOC-B',
      '    section: ADRs',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(root, 'docs/a.md'),
    '---\ndoc_id: DOC-A\ntitle: Doc A\nversion: 1.0.0\nstatus: active\n---\n\n# A\n\nSee [B](adr/b.md).\n',
  );
  const rows = Array.from({ length: 150 }, (_, index) => `| ${index} |`).join('\n');
  await fs.writeFile(
    path.join(root, 'docs/adr/b.md'),
    `---\ndoc_id: DOC-B\ntitle: Doc B\n---\n\n| N |\n| - |\n${rows}\n`,
  );
  const state = {
    repository: { url: 'https://github.com/o/r', source_commit: 'old' },
    notion: {
      root_page: { page_id: 'root' },
      sections: { ADRs: { page_id: 'adrs' } },
      document_index: { data_source_id: 'ds' },
    },
    sync: {},
    documents: {
      'DOC-A': {
        path: 'docs/a.md',
        checksum_sha256: 'stale',
        notion_page_id: 'page-a',
        index_row_page_id: 'row-a',
      },
    },
  };
  await fs.writeFile(path.join(root, 'docs/_meta/notion-state.json'), JSON.stringify(state));
  return root;
}

test('syncDocs creates, updates and records state idempotently', async () => {
  const root = await fixture();
  const notion = fakeNotion();
  notion.children.set('page-a', [
    { id: 'old-block', type: 'paragraph' },
    { id: 'kept', type: 'child_page', child_page: { title: 'x' } },
  ]);
  const client = createNotionClient({
    token: 'secret',
    baseUrl: 'https://notion.test/v1',
    minIntervalMs: 0,
    fetchImpl: notion.fetchImpl,
  });
  const commit = 'abcdef1234567';
  const logs = [];
  const { report, state } = await syncDocs({
    root,
    client,
    commit,
    now: () => new Date('2026-09-30T00:00:00Z'),
    log: (line) => logs.push(line),
  });

  assert.deepEqual(report.created, ['DOC-B']);
  assert.deepEqual(report.updated, ['DOC-A']);
  assert.deepEqual(report.failed, []);

  const pageA = notion.children.get('page-a');
  assert.deepEqual(
    pageA.map((block) => block.type),
    ['child_page', 'callout', 'heading_1', 'paragraph'],
  );
  const bId = state.documents['DOC-B'].notion_page_id;
  const link = pageA[3].paragraph.rich_text.find((item) => item.text.link);
  assert.equal(link.text.link.url, `https://app.notion.com/p/${bId.replaceAll('-', '')}`);

  const table = notion.children.get(bId).find((block) => block.type === 'table');
  assert.equal(notion.children.get(table.id).length, 151);

  const rowA = notion.pages.get('row-a');
  assert.equal(rowA.properties['Doc ID'].rich_text[0].text.content, 'DOC-A');
  assert.equal(rowA.properties.Name.title[0].text.content, 'Doc A');
  assert.equal(rowA.properties['Commit SHA'].rich_text[0].text.content, commit);
  assert.equal(rowA.properties.Status.select.name, 'active');

  const saved = JSON.parse(
    await fs.readFile(path.join(root, 'docs/_meta/notion-state.json'), 'utf8'),
  );
  assert.equal(saved.repository.source_commit, commit);
  assert.equal(saved.sync.created, 1);
  assert.equal(saved.documents['DOC-B'].synced_commit, commit);
  assert.ok(saved.documents['DOC-B'].index_row_page_id);

  const before = notion.calls.length;
  const second = await syncDocs({ root, client, commit, log: () => {} });
  assert.deepEqual(second.report.unchanged, ['DOC-A', 'DOC-B']);
  assert.equal(notion.calls.length - before, 1, 'only the schema is read when nothing changed');
});

test('dry run needs no token and reports the plan', async () => {
  const root = await fixture();
  const logs = [];
  const { report } = await syncDocs({ root, dryRun: true, log: (line) => logs.push(line) });
  assert.deepEqual(report.created, ['DOC-B']);
  assert.deepEqual(report.updated, ['DOC-A']);
  assert.match(logs[0], /dry run/);
});

test('client retries rate-limited requests', async () => {
  let attempts = 0;
  const client = createNotionClient({
    token: 't',
    minIntervalMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '0.01' } })
        : new Response('{"ok":true}', { status: 200 });
    },
  });
  assert.deepEqual(await client.request('GET', '/x'), { ok: true });
  assert.equal(attempts, 2);
});
