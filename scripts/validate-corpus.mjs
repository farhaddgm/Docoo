import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Validates the versioned acceptance corpus (QA-002): checksums, expected evidence, image-only
// PDFs, audio properties and the absence of personal data in ground-truth files.

const root = path.resolve(process.argv[2] ?? 'qa/acceptance-corpus/v0');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const failures = [];
const fail = (message) => failures.push(message);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const personalData = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+98|0098|\b0)9\d{9}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bIR\d{24}\b/i,
];

function wavInfo(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let format;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        byteRate: buffer.readUInt32LE(offset + 16),
      };
    }
    if (id === 'data' && format) {
      return { ...format, durationSeconds: size / format.byteRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('missing fmt/data chunk');
}

if (!/^v\d+$/.test(manifest.version) || path.basename(root) !== manifest.version) {
  fail('manifest version must match its folder name (v0, v1, ...)');
}
const ids = new Set();
const listed = new Set(['manifest.json']);
for (const item of manifest.items ?? []) {
  if (ids.has(item.id)) fail(`${item.id}: duplicate id`);
  ids.add(item.id);
  if (!['fa', 'en'].includes(item.language)) fail(`${item.id}: unsupported language`);
  for (const [name, expected] of Object.entries(item.sha256 ?? {})) {
    listed.add(name);
    const content = await fs.readFile(path.join(root, name)).catch(() => null);
    if (!content) fail(`${item.id}: ${name} is missing`);
    else if (sha256(content) !== expected) fail(`${item.id}: ${name} checksum mismatch`);
  }
  for (const required of [item.file, item.expected?.transcript]) {
    if (!required || !item.sha256?.[required]) fail(`${item.id}: ${required} has no checksum`);
  }

  const transcript = await fs.readFile(path.join(root, item.expected.transcript), 'utf8');
  if (transcript.trim().length === 0) fail(`${item.id}: empty transcript`);
  for (const phrase of item.expected.mustContain ?? []) {
    if (!transcript.includes(phrase)) fail(`${item.id}: transcript lacks "${phrase}"`);
  }
  for (const pattern of personalData) {
    if (pattern.test(transcript))
      fail(`${item.id}: transcript looks like it contains personal data`);
  }

  const file = await fs.readFile(path.join(root, item.file));
  if (item.kind === 'pdf') {
    const text = file.toString('latin1');
    if (!text.startsWith('%PDF-')) fail(`${item.id}: not a PDF`);
    const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    if (pages !== item.expected.pages)
      fail(`${item.id}: expected ${item.expected.pages} pages, found ${pages}`);
    if (!/\/Subtype\s*\/Image/.test(text)) fail(`${item.id}: PDF has no page image`);
    if (item.expected.textLayer === false && /\/Font\b/.test(text)) {
      fail(`${item.id}: a scanned fixture must not have a text layer`);
    }
  } else if (item.kind === 'audio') {
    try {
      const info = wavInfo(file);
      if (info.sampleRate !== item.expected.sampleRate) fail(`${item.id}: sample rate differs`);
      if (info.channels !== item.expected.channels) fail(`${item.id}: channel count differs`);
      if (Math.abs(info.durationSeconds - item.expected.durationSeconds) > 0.05) {
        fail(`${item.id}: duration differs`);
      }
    } catch (error) {
      fail(`${item.id}: ${error.message}`);
    }
  } else {
    fail(`${item.id}: unknown kind ${item.kind}`);
  }
}

for (const entry of await fs.readdir(root)) {
  if (!listed.has(entry)) fail(`${entry} is not listed in the manifest`);
}

if (failures.length > 0) {
  console.error(`Acceptance corpus ${manifest.version} is invalid:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Acceptance corpus ${manifest.version}: ${manifest.items.length} items verified.`);
