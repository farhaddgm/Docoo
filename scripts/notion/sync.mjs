// Repository → Notion documentation sync (see docs/07-integrations/01-notion-and-github.md).
//
//   node scripts/notion/sync.mjs --dry-run   # plan only, no network access
//   NOTION_TOKEN=... SOURCE_COMMIT=<sha> node scripts/notion/sync.mjs [--force]
//
// Pages are matched by doc_id through docs/_meta/notion-state.json, never by title.
// Documents whose checksum is unchanged are skipped unless --force is given.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createNotionClient } from './client.mjs';
import { markdownToBlocks, parseFrontMatter, richText } from './markdown.mjs';

export const MANIFEST_PATH = 'docs/_meta/notion-manifest.yaml';
export const STATE_PATH = 'docs/_meta/notion-state.json';

const PRESERVED_BLOCK_TYPES = new Set(['child_page', 'child_database']);

export function parseManifest(manifest) {
  const entries = [
    ...manifest.matchAll(/^\s+- path: (.+)\n\s+doc_id: (.+)\n\s+section: (.+)$/gm),
  ].map(([, filePath, docId, section]) => ({
    filePath: filePath.trim(),
    docId: docId.trim(),
    section: section.trim().replace(/^['"]|['"]$/g, ''),
  }));
  if (entries.length === 0) throw new Error('Manifest has no documents.');
  return entries;
}

const compactId = (id) => id.replaceAll('-', '');
const pageUrl = (id) => `https://app.notion.com/p/${compactId(id)}`;

export async function planSync({ root, state, force = false }) {
  const manifest = await fs.readFile(path.join(root, MANIFEST_PATH), 'utf8');
  const docs = [];
  for (const entry of parseManifest(manifest)) {
    const raw = await fs.readFile(path.join(root, entry.filePath));
    const checksum = createHash('sha256').update(raw).digest('hex');
    const { data, body } = parseFrontMatter(raw.toString('utf8'));
    if (data.doc_id !== entry.docId) {
      throw new Error(`${entry.filePath} does not declare ${entry.docId}.`);
    }
    const previous = state.documents[entry.docId];
    const sectionPageId =
      entry.section === 'Root'
        ? state.notion.root_page?.page_id
        : state.notion.sections[entry.section]?.page_id;
    let action;
    if (!sectionPageId) action = 'failed';
    else if (!previous?.notion_page_id) action = 'create';
    else if (force || previous.checksum_sha256 !== checksum || !previous.index_row_page_id)
      action = 'update';
    else action = 'unchanged';
    docs.push({ ...entry, checksum, front: data, body, previous, sectionPageId, action });
  }
  return docs;
}

function propertyValue(type, value) {
  if (value === undefined || value === null || value === '') return undefined;
  switch (type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: value } }] };
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: value } }] };
    case 'select':
      return { select: { name: value } };
    case 'status':
      return { status: { name: value } };
    case 'date':
      return { date: { start: value } };
    case 'url':
      return { url: value };
    default:
      return undefined;
  }
}

export function indexProperties(schema, values) {
  const properties = {};
  const byName = new Map(
    Object.entries(schema).map(([name, definition]) => [name.toLowerCase(), [name, definition]]),
  );
  for (const [name, value] of Object.entries(values)) {
    const match = name === '$title' ? findTitle(schema) : byName.get(name.toLowerCase());
    if (!match) continue;
    const built = propertyValue(match[1].type, value);
    if (built) properties[match[0]] = built;
  }
  return properties;
}

function findTitle(schema) {
  return Object.entries(schema).find(([, definition]) => definition.type === 'title');
}

const MAX_BLOCKS_PER_ARRAY = 100;
const MAX_BLOCKS_PER_REQUEST = 1000;

async function appendAll(client, parentId, blocks) {
  let start = 0;
  while (start < blocks.length) {
    const payload = [];
    const overflow = [];
    let total = 0;
    while (start < blocks.length && payload.length < MAX_BLOCKS_PER_ARRAY) {
      const item = blocks[start];
      const children = item[item.type].children ?? [];
      const inline = children.slice(0, MAX_BLOCKS_PER_ARRAY);
      if (payload.length > 0 && total + 1 + inline.length > MAX_BLOCKS_PER_REQUEST) break;
      if (children.length > inline.length) {
        overflow.push([payload.length, children.slice(inline.length)]);
        payload.push({ ...item, [item.type]: { ...item[item.type], children: inline } });
      } else {
        payload.push(item);
      }
      total += 1 + inline.length;
      start += 1;
    }
    const response = await client.appendChildren(parentId, payload);
    for (const [index, rest] of overflow) {
      await appendAll(client, response.results[index].id, rest);
    }
  }
}

async function findExisting(client, doc, dataSourceId, schema) {
  const title = doc.front.title ?? doc.docId;
  const children = await client.listChildren(doc.sectionPageId);
  const page = children.find(
    (child) => child.type === 'child_page' && child.child_page.title === title,
  );
  const docIdProperty = Object.entries(schema).find(([name]) => name.toLowerCase() === 'doc id');
  let row;
  if (docIdProperty && ['title', 'rich_text'].includes(docIdProperty[1].type)) {
    const result = await client.request('POST', `/data_sources/${dataSourceId}/query`, {
      filter: { property: docIdProperty[0], [docIdProperty[1].type]: { equals: doc.docId } },
      page_size: 1,
    });
    row = result.results?.[0];
  }
  return { pageId: page?.id, rowId: row?.id };
}

// The root page opens with a hand-written "source and policy" list. Nothing else
// rewrites it, so after every publish its commit and sync-time bullets are refreshed
// in place (matched by their label, never by position) to keep the header truthful.
const ROOT_COMMIT_LABEL = 'Source commit:';
const ROOT_SYNC_LABEL = 'آخرین همگام‌سازی';

const blockText = (block) =>
  (block.bulleted_list_item?.rich_text ?? [])
    .map((item) => item.plain_text ?? item.text?.content ?? '')
    .join('');

export async function refreshRootHeader({
  client,
  rootPageId,
  repoUrl,
  commit,
  syncedAt,
  total,
  synced,
}) {
  const bullets = (await client.listChildren(rootPageId)).filter(
    (block) => block.type === 'bulleted_list_item',
  );
  const commitBlock = bullets.find((block) => blockText(block).startsWith(ROOT_COMMIT_LABEL));
  const syncBlock = bullets.find((block) => blockText(block).startsWith(ROOT_SYNC_LABEL));
  if (!commitBlock || !syncBlock) return false;
  const code = (content, link) => ({
    type: 'text',
    text: { content, ...(link ? { link: { url: link } } : {}) },
    annotations: { code: true },
  });
  await client.updateBlock(commitBlock.id, {
    bulleted_list_item: {
      rich_text: [
        ...richText(`${ROOT_COMMIT_LABEL} `),
        code(commit, `${repoUrl}/commit/${commit}`),
      ],
    },
  });
  await client.updateBlock(syncBlock.id, {
    bulleted_list_item: {
      rich_text: richText(
        `${ROOT_SYNC_LABEL} محتوا و فهرست: ${syncedAt.slice(0, 10)} — ${synced} از ${total} سند به همین SHA متصل است.`,
      ),
    },
  });
  return true;
}

export async function syncDocs({
  root,
  client,
  commit,
  dryRun = false,
  force = false,
  now = () => new Date(),
  log = console.log,
}) {
  const statePath = path.join(root, STATE_PATH);
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const docs = await planSync({ root, state, force });
  const report = { created: [], updated: [], unchanged: [], failed: [] };

  for (const doc of docs) {
    if (doc.action === 'failed') {
      report.failed.push({ docId: doc.docId, reason: `Unknown Notion section "${doc.section}"` });
    } else if (doc.action === 'unchanged') {
      report.unchanged.push(doc.docId);
    } else if (dryRun) {
      report[doc.action === 'create' ? 'created' : 'updated'].push(doc.docId);
    }
  }
  if (dryRun) {
    log(formatReport(report, true));
    return { report, state };
  }
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
    throw new Error('SOURCE_COMMIT must be the Git commit SHA being published.');
  }

  const repoUrl = state.repository.url;
  const dataSourceId = state.notion.document_index.data_source_id;
  const schema = (await client.getDataSource(dataSourceId)).properties ?? {};
  const pending = docs.filter((doc) => doc.action === 'create' || doc.action === 'update');
  const pageUrlByPath = new Map(
    docs
      .filter((doc) => doc.previous?.notion_page_id)
      .map((doc) => [
        doc.filePath,
        doc.previous.notion_page_url ?? pageUrl(doc.previous.notion_page_id),
      ]),
  );

  log(`Publishing ${pending.length} of ${docs.length} documents to Notion…`);

  // Phase 1: make sure every document has a page so cross-document links resolve.
  for (const doc of pending.filter((d) => d.action === 'create')) {
    try {
      const existing = await findExisting(client, doc, dataSourceId, schema);
      let pageId = existing.pageId;
      if (!pageId) {
        const page = await client.createPage({
          parent: { page_id: doc.sectionPageId },
          properties: {
            title: { title: [{ type: 'text', text: { content: doc.front.title ?? doc.docId } }] },
          },
        });
        pageId = page.id;
      }
      doc.pageId = pageId;
      doc.rowId = existing.rowId;
      pageUrlByPath.set(doc.filePath, pageUrl(pageId));
    } catch (error) {
      doc.error = error;
    }
  }

  const syncedAt = now().toISOString();
  const saveState = () => fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  for (const [index, doc] of pending.entries()) {
    const progress = `[${index + 1}/${pending.length}] ${doc.docId}`;
    if (doc.error) {
      report.failed.push({ docId: doc.docId, reason: doc.error.message });
      log(`${progress}: failed — ${doc.error.message}`);
      continue;
    }
    const pageId = doc.pageId ?? doc.previous.notion_page_id;
    const url = pageUrlByPath.get(doc.filePath);
    const blobUrl = (file) => `${repoUrl}/blob/${commit}/${file}`;
    const resolveLink = (href) => {
      if (/^(https?:|mailto:)/i.test(href)) return href;
      if (href.startsWith('#')) return null;
      const [target] = href.split('#');
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(doc.filePath), target),
      );
      return pageUrlByPath.get(resolved) ?? blobUrl(resolved);
    };
    try {
      const banner = {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: 'ℹ️' },
          rich_text: [
            ...richText(
              'این صفحه به‌صورت خودکار از GitHub تولید می‌شود و ویرایش مستقیم آن در sync بعدی بازنویسی می‌شود. منبع: ',
            ),
            {
              type: 'text',
              text: {
                content: `${doc.filePath}@${commit.slice(0, 7)}`,
                link: { url: blobUrl(doc.filePath) },
              },
            },
          ],
        },
      };
      const existingBlocks = await client.listChildren(pageId);
      for (const child of existingBlocks) {
        if (!PRESERVED_BLOCK_TYPES.has(child.type)) await client.deleteBlock(child.id);
      }
      await appendAll(client, pageId, [banner, ...markdownToBlocks(doc.body, { resolveLink })]);
      await client.updatePage(pageId, {
        properties: {
          title: { title: [{ type: 'text', text: { content: doc.front.title ?? doc.docId } }] },
        },
      });

      const properties = indexProperties(schema, {
        $title: doc.front.title ?? doc.docId,
        'Doc ID': doc.docId,
        Version: doc.front.version,
        Status: doc.front.status,
        Owner: doc.front.owner,
        Section: doc.section,
        'Source Path': doc.filePath,
        'Commit SHA': commit,
        Checksum: doc.checksum,
        'Last Synced': syncedAt,
        'Notion Page': url,
        Page: url,
      });
      let rowId = doc.rowId ?? doc.previous?.index_row_page_id;
      if (rowId) {
        await client.updatePage(rowId, { properties });
      } else {
        const row = await client.createPage({
          parent: { type: 'data_source_id', data_source_id: dataSourceId },
          properties,
        });
        rowId = row.id;
      }

      state.documents[doc.docId] = {
        ...doc.previous,
        path: doc.filePath,
        section: doc.section,
        version: doc.front.version,
        status: doc.front.status,
        owner: doc.front.owner,
        checksum_sha256: doc.checksum,
        notion_page_id: pageId,
        notion_page_url: url,
        index_row_page_id: rowId,
        index_row_page_url: pageUrl(rowId),
        synced_commit: commit,
        synced_at: syncedAt,
      };
      report[doc.action === 'create' ? 'created' : 'updated'].push(doc.docId);
      // Persist after every document so an interrupted run resumes where it stopped.
      await saveState();
      log(`${progress}: ${doc.action === 'create' ? 'created' : 'updated'}`);
    } catch (error) {
      report.failed.push({ docId: doc.docId, reason: error.message });
      log(`${progress}: failed — ${error.message}`);
    }
  }

  const manifestIds = new Set(docs.map((doc) => doc.docId));
  const synced = docs.length - report.failed.length;
  if (pending.length > 0 || state.repository.source_commit !== commit) {
    try {
      const refreshed = await refreshRootHeader({
        client,
        rootPageId: state.notion.root_page.page_id,
        repoUrl,
        commit,
        syncedAt,
        total: docs.length,
        synced,
      });
      if (!refreshed) log('Root page header not found; left unchanged.');
    } catch (error) {
      log(`Root page header not refreshed: ${error.message}`);
    }
  }
  state.repository.source_commit = commit;
  state.sync = {
    synced_at: syncedAt,
    created: report.created.length,
    updated: report.updated.length,
    unchanged: report.unchanged.length,
    failed: report.failed.length,
    failures: report.failed,
    validation: {
      manifest_documents: docs.length,
      state_documents: Object.keys(state.documents).filter((id) => manifestIds.has(id)).length,
      orphaned_state_documents: Object.keys(state.documents).filter((id) => !manifestIds.has(id)),
    },
  };
  await saveState();
  log(formatReport(report, false));
  return { report, state };
}

export function formatReport(report, dryRun) {
  const lines = [
    `${dryRun ? 'Notion sync plan (dry run)' : 'Notion sync result'}:`,
    `  ${dryRun ? 'create' : 'created'}: ${report.created.length}${report.created.length ? ` — ${report.created.join(', ')}` : ''}`,
    `  ${dryRun ? 'update' : 'updated'}: ${report.updated.length}${report.updated.length ? ` — ${report.updated.join(', ')}` : ''}`,
    `  unchanged: ${report.unchanged.length}`,
    `  failed: ${report.failed.length}`,
    ...report.failed.map((failure) => `    ${failure.docId}: ${failure.reason}`),
  ];
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const { report } = await syncDocs({
    root: process.cwd(),
    dryRun,
    force: args.has('--force'),
    commit: process.env.SOURCE_COMMIT,
    client: dryRun
      ? undefined
      : createNotionClient({
          token: process.env.NOTION_TOKEN,
          baseUrl: process.env.NOTION_API_BASE_URL,
        }),
  });
  if (report.failed.length > 0) process.exitCode = 1;
}
