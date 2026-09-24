import fs from 'node:fs/promises';
import path from 'node:path';

const manifest = await fs.readFile('docs/_meta/notion-manifest.yaml', 'utf8');
const entries = [...manifest.matchAll(/^\s+- path: (.+)\n\s+doc_id: (.+)\n\s+section:/gm)].map(
  ([, filePath, docId]) => ({ filePath, docId }),
);

if (entries.length === 0) throw new Error('Manifest has no documents.');
const ids = new Set();
for (const entry of entries) {
  if (ids.has(entry.docId)) throw new Error(`Duplicate doc_id: ${entry.docId}`);
  ids.add(entry.docId);
  const fullPath = path.resolve(entry.filePath);
  const content = await fs.readFile(fullPath, 'utf8');
  const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontMatter?.[1].includes(`doc_id: ${entry.docId}`)) {
    throw new Error(`${entry.filePath} does not declare ${entry.docId}.`);
  }
}

console.log(`Validated ${entries.length} manifest documents with unique doc_id values.`);
