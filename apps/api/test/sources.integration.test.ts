import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { objectKeys } from '@docoo/ingestion';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

const corpus = join(import.meta.dirname, '..', '..', '..', 'qa', 'acceptance-corpus', 'v0');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const hasOcr = (() => {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'pipe' });
    execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

interface Version {
  id: string;
  versionNo: number;
  status: string;
  failureCode: string | null;
  sha256: string | null;
  sniffedMime: string | null;
  supersedesVersionId: string | null;
  extraction: Record<string, unknown> | null;
}
interface Upload {
  source: { id: string; version: number };
  version: Version;
  upload: { url: string; method: string; headers: Record<string, string> };
}

let h: Harness;
let cookie: string;
const sources = (suffix = '') => `/v1/workspaces/${h.ids.workspaceA}/sources${suffix}`;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`),
  });
}

async function upload(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  title = filename,
): Promise<Upload> {
  const response = await h.request('POST', sources('/uploads'), {
    cookie,
    payload: {
      title,
      filename,
      mime,
      size: bytes.length,
      sha256: sha(bytes),
      scope: { type: 'workspace', id: h.ids.workspaceA },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Upload>();
}

/** Simulates the browser PUT to the presigned URL. */
async function put(sourceId: string, versionId: string, bytes: Uint8Array, mime: string) {
  await h.objects.put(objectKeys.quarantine(h.ids.workspaceA, sourceId, versionId), bytes, mime);
}

async function finalize(sourceId: string, versionId: string): Promise<Version> {
  const response = await h.request('POST', sources(`/${sourceId}/versions/${versionId}/finalize`), {
    cookie,
    payload: {},
  });
  expect(response.statusCode, response.body).toBe(202);
  return response.json<{ version: Version }>().version;
}

async function ingest(bytes: Uint8Array, filename: string, mime: string) {
  const created = await upload(bytes, filename, mime);
  await put(created.source.id, created.version.id, bytes, mime);
  return { created, version: await finalize(created.source.id, created.version.id) };
}

async function auditActions(
  targetId: string,
): Promise<{ action: string; severity: string; security_relevant: boolean }[]> {
  return (
    await h.admin.query<{ action: string; severity: string; security_relevant: boolean }>(
      `select action, severity, security_relevant from audit_events where target_id = $1 or after->>'versionId' = $1::text or after->>'assetId' = $1::text
        order by occurred_at, id`,
      [targetId],
    )
  ).rows;
}

describe.skipIf(!adminUrl)('sources: upload, quarantine, extraction and lineage (ING-*)', () => {
  beforeAll(async () => {
    h = await createHarness('sources');
    cookie = await h.login(h.emails.a);
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('ING-001: issues a presigned upload with size limit, checksum and audit', async () => {
    const bytes = docx(['Quarterly report.', 'Sales grew 20% in 2025 because demand rose.']);
    const created = await upload(bytes, 'report.docx', DOCX, 'Quarterly report');
    expect(created.upload).toMatchObject({ method: 'PUT', headers: { 'content-type': DOCX } });
    expect(created.upload.url).toContain(
      objectKeys.quarantine(h.ids.workspaceA, created.source.id, created.version.id),
    );
    expect(created.version).toMatchObject({ status: 'uploaded', versionNo: 1 });

    const early = await h.request(
      'POST',
      sources(`/${created.source.id}/versions/${created.version.id}/finalize`),
      {
        cookie,
        payload: {},
      },
    );
    expect(early.json<{ code: string }>().code).toBe('SOURCE_UPLOAD_INCOMPLETE');

    await put(created.source.id, created.version.id, bytes, DOCX);
    const version = await finalize(created.source.id, created.version.id);
    expect(version).toMatchObject({ status: 'indexed', sha256: sha(bytes), sniffedMime: DOCX });
    expect(
      h.objects.objects.has(
        objectKeys.accepted(h.ids.workspaceA, created.source.id, created.version.id),
      ),
    ).toBe(true);
    expect(
      h.objects.objects.has(
        objectKeys.quarantine(h.ids.workspaceA, created.source.id, created.version.id),
      ),
    ).toBe(false);

    const actions = (await auditActions(created.source.id)).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'source.upload_requested',
        'source.upload_finalized',
        'source.accepted',
        'source.extracted',
      ]),
    );

    const tooBig = await h.request('POST', sources('/uploads'), {
      cookie,
      payload: {
        title: 'x',
        filename: 'big.pdf',
        mime: 'application/pdf',
        size: 101 * 1024 * 1024,
        sha256: 'a'.repeat(64),
        scope: { type: 'workspace', id: h.ids.workspaceA },
      },
    });
    expect(tooBig.statusCode).toBe(413);
    const unsupported = await h.request('POST', sources('/uploads'), {
      cookie,
      payload: {
        title: 'x',
        filename: 'tool.exe',
        mime: 'application/x-msdownload',
        size: 10,
        sha256: 'a'.repeat(64),
        scope: { type: 'workspace', id: h.ids.workspaceA },
      },
    });
    expect(unsupported.statusCode).toBe(415);
  });

  it('ING-001: the size limit comes from settings', async () => {
    const set = await h.request('PUT', `/v1/workspaces/${h.ids.workspaceA}/settings/assignments`, {
      cookie,
      payload: {
        key: 'ingestion.max_file_mb',
        scopeType: 'workspace',
        scopeId: h.ids.workspaceA,
        value: 1,
        reason: 'Small files only',
      },
    });
    expect(set.statusCode, set.body).toBe(200);
    const response = await h.request('POST', sources('/uploads'), {
      cookie,
      payload: {
        title: 'x',
        filename: 'two.pdf',
        mime: 'application/pdf',
        size: 2 * 1024 * 1024,
        sha256: 'a'.repeat(64),
        scope: { type: 'workspace', id: h.ids.workspaceA },
      },
    });
    expect(response.statusCode).toBe(413);
    await h.request('PUT', `/v1/workspaces/${h.ids.workspaceA}/settings/assignments`, {
      cookie,
      payload: {
        key: 'ingestion.max_file_mb',
        scopeType: 'workspace',
        scopeId: h.ids.workspaceA,
        value: null,
        reason: 'Back to default',
      },
    });
  });

  it('ING-002: an infected file stays in quarantine, never reaches the parser and raises a security event', async () => {
    const bytes = strToU8(EICAR);
    const { created, version } = await ingest(bytes, 'notes.txt', 'text/plain');
    expect(version).toMatchObject({ status: 'rejected', failureCode: 'malware_detected' });
    const segments = await h.admin.query(
      'select 1 from source_segments where source_version_id = $1',
      [created.version.id],
    );
    expect(segments.rowCount).toBe(0);
    expect(
      h.objects.objects.has(
        objectKeys.accepted(h.ids.workspaceA, created.source.id, created.version.id),
      ),
    ).toBe(false);
    const events = await auditActions(created.version.id);
    expect(events).toContainEqual({
      action: 'source.rejected',
      severity: 'critical',
      security_relevant: true,
    });
  });

  it('ING-002: a renamed executable and a tampered upload are rejected', async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    const renamed = await ingest(exe, 'invoice.pdf', 'application/pdf');
    expect(renamed.version).toMatchObject({ status: 'rejected', failureCode: 'unsupported_type' });

    const declared = strToU8('original text');
    const created = await upload(declared, 'a.txt', 'text/plain');
    await put(created.source.id, created.version.id, strToU8('tampered text'), 'text/plain');
    const tampered = await finalize(created.source.id, created.version.id);
    expect(tampered).toMatchObject({ status: 'rejected', failureCode: 'checksum_mismatch' });
  });

  it('ING-002: with the scanner down the file stays quarantined and can be retried', async () => {
    const scanner = h.ingestion.scanner;
    h.ingestion.scanner = {
      scan: () =>
        Promise.resolve({ status: 'error', engine: 'clamd', signature: null, detail: 'down' }),
    };
    try {
      const { created, version } = await ingest(
        strToU8('Plain safe text.'),
        'safe.txt',
        'text/plain',
      );
      expect(version).toMatchObject({ status: 'quarantined', failureCode: 'scan_unavailable' });
      h.ingestion.scanner = scanner;
      const retried = await h.request(
        'POST',
        sources(`/${created.source.id}/versions/${created.version.id}/retry`),
        { cookie, payload: {} },
      );
      expect(retried.json<{ version: Version }>().version.status).toBe('indexed');
    } finally {
      h.ingestion.scanner = scanner;
    }
  });

  it('ING-003: extracted segments keep their location in the original file', async () => {
    const { created } = await ingest(
      docx(['First paragraph.', 'Second paragraph with 12%.']),
      'lineage.docx',
      DOCX,
    );
    const response = await h.request(
      'GET',
      sources(`/${created.source.id}/versions/${created.version.id}/segments`),
      { cookie },
    );
    expect(response.json<{ items: unknown[] }>().items).toEqual([
      { ordinal: 1, locator: { paragraph: 1 }, text: 'First paragraph.', confidence: null },
      {
        ordinal: 2,
        locator: { paragraph: 2 },
        text: 'Second paragraph with 12%.',
        confidence: null,
      },
    ]);
  });

  it.skipIf(!hasOcr)(
    'ING-004: scan-en-001 is OCRed with page lineage',
    async () => {
      const pdf = readFileSync(join(corpus, 'scanned-en-memo.pdf'));
      const { created, version } = await ingest(pdf, 'memo.pdf', 'application/pdf');
      expect(version.status).toBe('indexed');
      expect(version.extraction).toMatchObject({ ocrPages: [1, 2], pageCount: 2 });
      const segments = await h.admin.query<{
        locator: { page: number; ocr: number };
        confidence: number;
      }>(
        'select locator, confidence from source_segments where source_version_id = $1 order by ordinal',
        [created.version.id],
      );
      expect(segments.rows.map((row) => row.locator)).toEqual([
        { page: 1, ocr: 1 },
        { page: 2, ocr: 1 },
      ]);
      expect(segments.rows.every((row) => row.confidence > 0.5)).toBe(true);
    },
    120_000,
  );

  it('ING-005: audio without a configured transcriber is partial with a clear reason', async () => {
    const wav = readFileSync(join(corpus, 'audio-en-note.wav'));
    const { version } = await ingest(wav, 'note.wav', 'audio/wav');
    expect(version.status).toBe('partial');
    expect(version.extraction).toMatchObject({ warnings: ['transcription_not_configured'] });
  });

  it('ING-006: text enters the pipeline; URLs are checked against policy before anything is fetched', async () => {
    const text = await h.request('POST', sources('/text'), {
      cookie,
      payload: {
        title: 'Pasted',
        text: 'Pasted policy text.\n\nSecond block.',
        scope: { type: 'workspace', id: h.ids.workspaceA },
      },
    });
    expect(text.statusCode, text.body).toBe(202);
    expect(text.json<{ version: Version }>().version.status).toBe('indexed');

    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'https://not-allowlisted.example.com/x',
      'file:///etc/passwd',
    ]) {
      const rejected = await h.request('POST', sources('/url'), {
        cookie,
        payload: { title: 'x', url, scope: { type: 'workspace', id: h.ids.workspaceA } },
      });
      expect(rejected.statusCode, url).toBe(400);
      expect(rejected.json<{ code: string }>().code).toBe('SOURCE_URL_REJECTED');
    }
    const audit = await h.admin.query(
      `select 1 from audit_events where workspace_id = $1 and action = 'source.url_rejected' and security_relevant`,
      [h.ids.workspaceA],
    );
    expect(audit.rowCount).toBe(3);
  });

  it('ING-006: an unreachable workflow engine keeps the file quarantined with 503', async () => {
    h.ingestion.available = false;
    try {
      const response = await h.request('POST', sources('/text'), {
        cookie,
        payload: {
          title: 'Later',
          text: 'Some text.',
          scope: { type: 'workspace', id: h.ids.workspaceA },
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json<{ code: string }>().code).toBe('SOURCE_INGESTION_UNAVAILABLE');
    } finally {
      h.ingestion.available = true;
    }
  });

  it('ING-007: a new version keeps lineage and makes dependent knowledge stale', async () => {
    const first = docx(['Policy v1: discounts must stay under 10%.']);
    const { created } = await ingest(first, 'policy.docx', DOCX);
    const knowledge = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/knowledge/from-source`,
      {
        cookie,
        payload: {
          sourceId: created.source.id,
          versionId: created.version.id,
          title: 'Discount policy',
          scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
          declaration: 'Approved internal policy document',
        },
      },
    );
    expect(knowledge.statusCode, knowledge.body).toBe(201);
    const knowledgeId = knowledge.json<{ knowledge: { id: string } }>().knowledge.id;
    const audited = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/knowledge/${knowledgeId}/submit-audit`,
      { cookie },
    );
    expect(audited.json<{ review: { decision: string } }>().review.decision).toBe('approved');

    const noPrecondition = await h.request('POST', sources(`/${created.source.id}/versions`), {
      cookie,
      payload: { filename: 'policy.docx', mime: DOCX, size: 10, sha256: 'b'.repeat(64) },
    });
    expect(noPrecondition.statusCode).toBe(428);

    const second = docx(['Policy v2: discounts must stay under 15%.']);
    const current = await h.request('GET', sources(`/${created.source.id}`), { cookie });
    const next = await h.request('POST', sources(`/${created.source.id}/versions`), {
      cookie,
      headers: { 'if-match': String(current.headers['etag']) },
      payload: {
        filename: 'policy.docx',
        mime: DOCX,
        size: second.length,
        sha256: sha(second),
        reason: 'Updated policy',
      },
    });
    expect(next.statusCode, next.body).toBe(201);
    const nextVersion = next.json<Upload>().version;
    expect(nextVersion).toMatchObject({ versionNo: 2, supersedesVersionId: created.version.id });
    await put(created.source.id, nextVersion.id, second, DOCX);
    expect((await finalize(created.source.id, nextVersion.id)).status).toBe('indexed');

    const lineage = await h.request('GET', sources(`/${created.source.id}`), { cookie });
    const versions = lineage.json<{ source: { currentVersionId: string; versions: Version[] } }>()
      .source;
    expect(versions.currentVersionId).toBe(nextVersion.id);
    expect(versions.versions.map((version) => version.versionNo)).toEqual([2, 1]);

    const detail = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceA}/knowledge/${knowledgeId}`,
      { cookie },
    );
    expect(
      detail.json<{
        knowledge: { currentVersion: { staleReason: string; effectiveDecision: string } };
      }>().knowledge.currentVersion,
    ).toMatchObject({
      staleReason: 'source_version_superseded',
      effectiveDecision: 'stale',
    });
    const retrieval = await h.request(
      'POST',
      `/v1/workspaces/${h.ids.workspaceA}/knowledge/retrieve`,
      {
        cookie,
        payload: { query: 'discounts policy' },
      },
    );
    expect(
      retrieval
        .json<{ results: { knowledgeId: string }[] }>()
        .results.map((result) => result.knowledgeId),
    ).not.toContain(knowledgeId);
  });

  it('KNW-001: the source list names its scope, filters by scope and title, and links the knowledge built from each source', async () => {
    const workspace = `/v1/workspaces/${h.ids.workspaceA}`;
    const topic = await h.request('POST', `${workspace}/topics`, {
      cookie,
      payload: { code: 'src-topic', title: 'Source topic', description: 'Topic for sources' },
    });
    const topicId = topic.json<{ topic: { id: string } }>().topic.id;
    const project = await h.request('POST', `${workspace}/projects`, {
      cookie,
      payload: {
        code: 'src-project',
        title: 'Source project',
        initialProblem: 'Problem',
        topics: [{ topicId }],
      },
    });
    const projectId = project.json<{ project: { id: string } }>().project.id;
    const addText = async (title: string, scope: { type: string; id: string }) => {
      const response = await h.request('POST', sources('/text'), {
        cookie,
        payload: { title, text: `${title} says that churn is measured monthly.`, scope },
      });
      expect(response.statusCode, response.body).toBe(202);
      return response.json<{ source: { id: string }; version: Version }>();
    };
    const one = await addText('Scoped note one', { type: 'project', id: projectId });
    await addText('Scoped note two', { type: 'project', id: projectId });
    await addText('Topic note', { type: 'topic', id: topicId });

    type Row = {
      id: string;
      title: string;
      scope: { type: string; id: string; title: string | null };
      knowledge: { id: string; title: string; status: string; stale: boolean }[];
    };
    const list = async (query: string) => {
      const response = await h.request('GET', sources(query), { cookie });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ items: Row[]; nextCursor: string | null }>();
    };

    const inProject = await list(`?scopeType=project&scopeId=${projectId}&limit=100`);
    expect(inProject.items.map((row) => row.title).sort()).toEqual([
      'Scoped note one',
      'Scoped note two',
    ]);
    expect(inProject.items[0]!.scope).toEqual({
      type: 'project',
      id: projectId,
      title: 'Source project',
    });
    expect((await list(`?scopeType=topic&scopeId=${topicId}`)).items[0]!.scope.title).toBe(
      'Source topic',
    );
    expect((await list('?q=NOTE%20ONE')).items.map((row) => row.id)).toEqual([one.source.id]);
    expect((await list(`?q=${encodeURIComponent('%')}`)).items).toEqual([]);

    const page = await list(`?scopeType=project&scopeId=${projectId}&limit=1`);
    expect(page.nextCursor).not.toBeNull();
    const foreign = await h.request(
      'GET',
      sources(`?scopeType=topic&scopeId=${topicId}&limit=1&cursor=${page.nextCursor}`),
      { cookie },
    );
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json<{ code: string }>().code).toBe('SOURCE_CURSOR_INVALID');
    const half = await h.request('GET', sources('?scopeType=project'), { cookie });
    expect(half.statusCode).toBe(400);

    expect((await list(`?q=Scoped%20note%20one`)).items[0]!.knowledge).toEqual([]);
    const built = await h.request('POST', `${workspace}/knowledge/from-source`, {
      cookie,
      payload: {
        sourceId: one.source.id,
        versionId: one.version.id,
        title: 'Built from note one',
        scopes: [{ type: 'project', id: projectId }],
        declaration: 'Written by the analytics team',
      },
    });
    expect(built.statusCode, built.body).toBe(201);
    const builtId = built.json<{ knowledge: { id: string } }>().knowledge.id;
    expect((await list(`?q=Scoped%20note%20one`)).items[0]!.knowledge).toEqual([
      { id: builtId, title: 'Built from note one', status: 'draft', stale: false },
    ]);
    const single = await h.request('GET', sources(`/${one.source.id}`), { cookie });
    expect(
      single.json<{ source: { knowledge: unknown[]; scope: { title: string } } }>().source,
    ).toMatchObject({
      scope: { title: 'Source project' },
      knowledge: [{ id: builtId }],
    });
  });

  it('KNW-004: knowledge that went stale is renewed from the newer version of its own source', async () => {
    const workspace = `/v1/workspaces/${h.ids.workspaceA}`;
    const { created } = await ingest(
      docx(['Margin rule v1: floors stay at 20%.']),
      'margin.docx',
      DOCX,
    );
    const built = await h.request('POST', `${workspace}/knowledge/from-source`, {
      cookie,
      payload: {
        sourceId: created.source.id,
        versionId: created.version.id,
        title: 'Margin rule',
        scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
        declaration: 'Approved pricing committee rule',
      },
    });
    const knowledgeId = built.json<{ knowledge: { id: string } }>().knowledge.id;
    const audit = (id: string) =>
      h.request('POST', `${workspace}/knowledge/${id}/submit-audit`, { cookie });
    expect(
      (await audit(knowledgeId)).json<{ review: { decision: string } }>().review.decision,
    ).toBe('approved');

    const current = await h.request('GET', sources(`/${created.source.id}`), { cookie });
    const second = docx(['Margin rule v2: floors stay at 25%.']);
    const next = await h.request('POST', sources(`/${created.source.id}/versions`), {
      cookie,
      headers: { 'if-match': String(current.headers['etag']) },
      payload: { filename: 'margin.docx', mime: DOCX, size: second.length, sha256: sha(second) },
    });
    const nextVersion = next.json<Upload>().version;
    await put(created.source.id, nextVersion.id, second, DOCX);
    expect((await finalize(created.source.id, nextVersion.id)).status).toBe('indexed');

    const stale = await h.request('GET', `${workspace}/knowledge/${knowledgeId}`, { cookie });
    type Detail = {
      knowledge: {
        version: number;
        currentVersion: {
          versionNo: number;
          status: string;
          staleReason: string | null;
          sourceVersionId: string;
          provenance: Record<string, unknown>;
          claims: {
            text: string;
            locator: Record<string, unknown>;
            sourceSegmentId: string | null;
          }[];
        };
      };
    };
    expect(stale.json<Detail>().knowledge.currentVersion.staleReason).toBe(
      'source_version_superseded',
    );
    const staleAudit = await audit(knowledgeId);
    expect(staleAudit.statusCode).toBe(409);
    expect(staleAudit.json<{ code: string }>().code).toBe('KNOWLEDGE_STALE');

    const renew = (
      payload: Record<string, unknown>,
      version = stale.json<Detail>().knowledge.version,
    ) =>
      h.request('POST', `${workspace}/knowledge/${knowledgeId}/versions`, {
        cookie,
        headers: { 'if-match': `"${version}"` },
        payload,
      });
    // Exactly one of new text or a source version; claims only go with text.
    expect((await renew({ reason: 'Nothing given' })).statusCode).toBe(400);
    expect(
      (await renew({ content: 'x', sourceVersionId: nextVersion.id, reason: 'Both' })).statusCode,
    ).toBe(400);
    expect(
      (
        await renew({
          sourceVersionId: nextVersion.id,
          claims: [{ text: 'x' }],
          reason: 'Claims with a source',
        })
      ).statusCode,
    ).toBe(400);
    // Only a version of the item's own source qualifies.
    const other = await ingest(docx(['Another document entirely.']), 'other.docx', DOCX);
    const foreign = await renew({
      sourceVersionId: other.created.version.id,
      reason: 'Wrong source',
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json<{ code: string }>().code).toBe('SOURCE_VERSION_NOT_FOUND');

    const renewed = await renew({
      sourceVersionId: nextVersion.id,
      reason: 'Source updated to v2',
    });
    expect(renewed.statusCode, renewed.body).toBe(201);
    const detail = renewed.json<Detail>().knowledge.currentVersion;
    expect(detail).toMatchObject({
      versionNo: 2,
      status: 'pending',
      staleReason: null,
      sourceVersionId: nextVersion.id,
      provenance: {
        sourceId: created.source.id,
        sourceVersionId: nextVersion.id,
        reason: 'Source updated to v2',
        partial: false,
      },
    });
    expect(detail.claims.map((claim) => claim.text)).toEqual([
      'Margin rule v2: floors stay at 25%.',
    ]);
    expect(detail.claims[0]!.locator).toMatchObject({ sourceVersionId: nextVersion.id });
    expect(detail.claims[0]!.sourceSegmentId).not.toBeNull();

    expect(
      (await audit(knowledgeId)).json<{ review: { decision: string } }>().review.decision,
    ).toBe('approved');
    const retrieval = await h.request('POST', `${workspace}/knowledge/retrieve`, {
      cookie,
      payload: { query: 'margin rule floors' },
    });
    const found = retrieval
      .json<{ results: { knowledgeId: string; text: string }[] }>()
      .results.find((result) => result.knowledgeId === knowledgeId);
    expect(found?.text).toContain('25%');

    // Knowledge that was not built from a source has no newer source version to take.
    const manual = await h.request('POST', `${workspace}/knowledge`, {
      cookie,
      payload: {
        title: 'Typed by hand',
        sourceType: 'admin_provided',
        provenance: { declaration: 'Typed in by the administrator' },
        scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
        content: 'Handwritten rule that stands on its own.',
      },
    });
    const handwritten = manual.json<{ knowledge: { id: string; version: number } }>().knowledge;
    const noSource = await h.request('POST', `${workspace}/knowledge/${handwritten.id}/versions`, {
      cookie,
      headers: { 'if-match': `"${handwritten.version}"` },
      payload: { sourceVersionId: nextVersion.id, reason: 'No source' },
    });
    expect(noSource.statusCode).toBe(409);
    expect(noSource.json<{ code: string }>().code).toBe('KNOWLEDGE_NO_SOURCE');
  });

  it('keeps sources inside their workspace', async () => {
    const { created } = await ingest(strToU8('Tenant A only.'), 'a.txt', 'text/plain');
    const cookieB = await h.login(h.emails.b);
    const foreign = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/sources/${created.source.id}`,
      { cookie: cookieB },
    );
    expect(foreign.statusCode).toBe(404);
    const crossPath = await h.request('GET', sources(`/${created.source.id}`), { cookie: cookieB });
    expect(crossPath.statusCode).toBe(404);
  });
});
