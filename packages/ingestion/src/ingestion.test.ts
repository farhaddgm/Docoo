import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { normalizeForSearch } from '@docoo/knowledge';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  characterAccuracy,
  checkArchive,
  checkMime,
  ClamdScanner,
  extractCsv,
  extractDocx,
  extractInSandbox,
  extractJson,
  extractPlainText,
  extractPptx,
  extractXlsx,
  fetchUrl,
  hostAllowed,
  htmlToText,
  isPublicAddress,
  MemoryObjectStore,
  objectKeys,
  OpenAiCompatibleTranscriber,
  parseClamdReply,
  parseCsv,
  probeSandbox,
  runPipeline,
  sniffMime,
  TesseractOcr,
  UnconfiguredTranscriber,
  validateUrl,
  wavDurationMs,
  type ExtractedSegment,
  type IngestionStore,
  type MalwareScanner,
  type OcrEngine,
  type PipelineAudit,
  type SourceStatus,
  type StoredVersion,
  type VersionPatch,
} from './index.js';

const corpus = join(import.meta.dirname, '..', '..', '..', 'qa', 'acceptance-corpus', 'v0');
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="w"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>گزارش فروش</w:t></w:r></w:p>
        <w:p><w:r><w:t xml:space="preserve">Sales grew </w:t></w:r><w:r><w:t>20% in 2025.</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Share</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
    ),
    'word/footnotes.xml': strToU8(
      '<w:footnotes xmlns:w="w"><w:footnote><w:p><w:r><w:t>Source: internal ledger</w:t></w:r></w:p></w:footnote></w:footnotes>',
    ),
  });
}

function pptx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/slides/slide2.xml': strToU8(
      '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Roadmap</a:t></a:r></a:p><a:p><a:r><a:t>Launch in March</a:t></a:r></a:p></p:sld>',
    ),
    'ppt/notesSlides/notesSlide1.xml': strToU8(
      '<p:notes xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Speaker note text</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>',
    ),
  });
}

function xlsx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      '<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Serv</t></r><r><t>ers</t></r></si></sst>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>
        <row r="1"><c r="B1" t="s"><v>1</v></c><c r="A1" t="s"><v>0</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c><c r="C2" t="inlineStr"><is><t>approved</t></is></c></row>
      </sheetData></worksheet>`,
    ),
  });
}

describe('MIME sniffing and quarantine checks (ING-002)', () => {
  it('detects the real type from content', () => {
    expect(sniffMime(readFileSync(join(corpus, 'scanned-en-memo.pdf')))).toBe('application/pdf');
    expect(sniffMime(docx())).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(sniffMime(pptx())).toContain('presentationml');
    expect(sniffMime(xlsx())).toContain('spreadsheetml');
    expect(sniffMime(readFileSync(join(corpus, 'audio-en-note.wav')))).toBe('audio/wav');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBe('application/x-executable');
    expect(sniffMime(strToU8('{"a":1}'), 'x.json')).toBe('application/json');
    expect(sniffMime(strToU8('a,b\n1,2'), 'x.csv')).toBe('text/csv');
    expect(sniffMime(strToU8('سلام دنیا'), 'x.txt')).toBe('text/plain');
  });

  it('rejects mismatched declarations and extensions', () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 1, 2]);
    expect(checkMime(exe, 'report.pdf', 'application/pdf')).toMatchObject({
      accepted: false,
      problem: 'unsupported_type',
    });
    const pdf = readFileSync(join(corpus, 'scanned-en-memo.pdf'));
    expect(checkMime(pdf, 'memo.pdf', 'application/msword').problem).toBe('mime_mismatch');
    expect(checkMime(pdf, 'memo.docx', 'application/pdf').problem).toBe('extension_mismatch');
    expect(checkMime(pdf, 'memo.pdf', 'application/pdf')).toMatchObject({
      accepted: true,
      problem: null,
    });
    expect(checkMime(strToU8('a,b'), 'data.csv', 'text/plain').accepted).toBe(true);
  });

  it('stops archive bombs before inflating', () => {
    const bomb = zipSync(
      {
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/huge.xml': new Uint8Array(20 * 1024 * 1024),
      },
      { level: 9 },
    );
    expect(checkArchive(bomb)).toMatchObject({ ok: false, problem: 'compression_ratio' });
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, strToU8('x')]));
    expect(
      checkArchive(zipSync(many), { maxEntries: 10, maxExpandedBytes: 1e9, maxRatio: 1e9 }).problem,
    ).toBe('too_many_entries');
    expect(checkArchive(docx()).ok).toBe(true);
  });

  it('parses clamd replies and fails closed when clamd is unreachable', async () => {
    expect(parseClamdReply('stream: OK\0')).toMatchObject({ status: 'clean' });
    expect(parseClamdReply('stream: Eicar-Signature FOUND\0')).toMatchObject({
      status: 'infected',
      signature: 'Eicar-Signature',
    });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR')).toMatchObject({
      status: 'error',
    });
    expect(await new ClamdScanner('127.0.0.1', 1, 2000).scan(strToU8('x'))).toMatchObject({
      status: 'error',
    });
  });
});

describe('structured extraction with lineage (ING-003)', () => {
  it('extracts DOCX paragraphs, headings, tables and footnotes', () => {
    const { segments } = extractDocx(docx());
    expect(segments).toEqual([
      { locator: { paragraph: 1, style: 'Heading1' }, text: 'گزارش فروش' },
      { locator: { paragraph: 2 }, text: 'Sales grew 20% in 2025.' },
      { locator: { table: 1, row: 1 }, text: 'Region | Share' },
      { locator: { table: 1, row: 2 }, text: 'North | 40%' },
      { locator: { footnote: 1 }, text: 'Source: internal ledger' },
    ]);
  });

  it('extracts PPTX slides in order with speaker notes', () => {
    expect(extractPptx(pptx()).segments).toEqual([
      { locator: { slide: 1, paragraph: 1 }, text: 'Roadmap' },
      { locator: { slide: 1, paragraph: 2 }, text: 'Launch in March' },
      { locator: { slide: 2, paragraph: 1 }, text: 'Second slide' },
      { locator: { slide: 1, notes: 1 }, text: 'Speaker note text' },
    ]);
  });

  it('extracts XLSX rows with sheet and cell range', () => {
    expect(extractXlsx(xlsx()).segments).toEqual([
      { locator: { sheet: 'Budget', row: 1, range: 'A1:B1' }, text: 'Item | Cost' },
      { locator: { sheet: 'Budget', row: 2, range: 'A2:C2' }, text: 'Servers | 1200 | approved' },
    ]);
  });

  it('extracts CSV, text, Markdown and JSON with line or path locators', () => {
    expect(parseCsv('a,"b,c"\n"x\ny",2\n')).toEqual([
      { line: 1, fields: ['a', 'b,c'] },
      { line: 2, fields: ['x\ny', '2'] },
    ]);
    expect(extractCsv(strToU8('name,cost\nServers,1200\n')).segments).toEqual([
      { locator: { line: 1, row: 1 }, text: 'name | cost' },
      { locator: { line: 2, row: 2 }, text: 'name: Servers | cost: 1200' },
    ]);
    expect(
      extractPlainText(strToU8('# Title\n\nFirst para\nstill first\n\n\nSecond')).segments,
    ).toEqual([
      { locator: { line: 1 }, text: '# Title' },
      { locator: { line: 3 }, text: 'First para\nstill first' },
      { locator: { line: 7 }, text: 'Second' },
    ]);
    expect(extractJson(strToU8('{"plan":{"budget":1200,"items":["a"]}}')).segments).toEqual([
      { locator: { path: 'plan.budget' }, text: 'plan.budget: 1200' },
      { locator: { path: 'plan.items[0]' }, text: 'plan.items[0]: a' },
    ]);
  });

  it('parses in a sandbox without network, writes, child processes or foreign reads', async () => {
    expect(await probeSandbox()).toEqual({
      fetch: true,
      socket: true,
      dns: true,
      readOutsideInput: true,
      write: true,
      childProcess: true,
      environmentEmpty: true,
    });
    const extraction = await extractInSandbox(
      docx(),
      checkMime(docx(), 'a.docx', sniffMime(docx())).sniffedMime,
    );
    expect(extraction.segments[1]).toEqual({
      locator: { paragraph: 2 },
      text: 'Sales grew 20% in 2025.',
    });
    const scanned = await extractInSandbox(
      readFileSync(join(corpus, 'scanned-en-memo.pdf')),
      'application/pdf',
    );
    expect(scanned).toMatchObject({ pageCount: 2, pagesNeedingOcr: [1, 2], segments: [] });
    await expect(extractInSandbox(strToU8('{bad'), 'application/json')).rejects.toMatchObject({
      code: 'parse_failed',
    });
  }, 60_000);
});

describe('URL guard (ING-006)', () => {
  it('blocks private, reserved and metadata addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe',
      '100.64.0.1',
      '64:ff9b::7f00:1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
  });

  it('validates scheme, credentials, ports, names and policy before any request', () => {
    const allow = { policy: 'allowlist' as const, allowlist: ['example.org'] };
    expect(() => validateUrl('ftp://example.org/a', allow)).toThrow('url_scheme');
    expect(() => validateUrl('https://u:p@example.org/', allow)).toThrow('url_credentials');
    expect(() => validateUrl('https://example.org:8443/', allow)).toThrow('url_port');
    expect(() =>
      validateUrl('http://169.254.169.254/latest', { policy: 'public', allowlist: [] }),
    ).toThrow('url_private_address');
    expect(() => validateUrl('http://localhost/', { policy: 'public', allowlist: [] })).toThrow(
      'url_private_address',
    );
    expect(() => validateUrl('https://evil.com/', allow)).toThrow('url_not_allowlisted');
    expect(() => validateUrl('https://example.org/', { policy: 'deny', allowlist: [] })).toThrow(
      'url_policy_denied',
    );
    expect(validateUrl('https://docs.example.org/x', allow).hostname).toBe('docs.example.org');
    expect(hostAllowed('notexample.org', ['example.org'])).toBe(false);
  });

  describe('fetching', () => {
    let server: Server;
    let port: string;
    beforeAll(async () => {
      server = createServer((request, response) => {
        if (request.url === '/redirect-private') {
          response.writeHead(302, { location: 'http://127.0.0.1/admin' });
          response.end();
        } else if (request.url === '/big') {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('x'.repeat(5000));
        } else if (request.url === '/binary') {
          response.writeHead(200, { 'content-type': 'application/octet-stream' });
          response.end('x');
        } else {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(
            '<html><title>Policy</title><script>alert(1)</script><p>Rule one.</p><p>Rule &amp; two.</p></html>',
          );
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = String((server.address() as AddressInfo).port);
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const options = () => ({
      policy: 'allowlist' as const,
      allowlist: ['docs.example.test'],
      maxBytes: 1000,
      allowedPorts: [port],
      resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      addressAllowed: (address: string) => address === '127.0.0.1',
    });

    it('fetches an allowlisted page through the pinned address', async () => {
      const page = await fetchUrl(`http://docs.example.test:${port}/policy`, options());
      expect(page.contentType).toContain('text/html');
      expect(htmlToText(new TextDecoder().decode(page.bytes))).toEqual({
        title: 'Policy',
        text: 'Policy Rule one.\nRule & two.',
      });
    });

    it('rejects DNS answers that point inside, redirects to private targets, big and binary bodies', async () => {
      await expect(
        fetchUrl(`http://docs.example.test:${port}/`, {
          ...options(),
          addressAllowed: isPublicAddress,
        }),
      ).rejects.toMatchObject({ code: 'url_private_address' });
      await expect(
        fetchUrl(`http://docs.example.test:${port}/redirect-private`, options()),
      ).rejects.toMatchObject({
        code: 'url_private_address',
      });
      await expect(
        fetchUrl(`http://docs.example.test:${port}/big`, options()),
      ).rejects.toMatchObject({
        code: 'url_too_large',
      });
      await expect(
        fetchUrl(`http://docs.example.test:${port}/binary`, options()),
      ).rejects.toMatchObject({
        code: 'url_content_type',
      });
    });
  });
});

describe('transcription adapter (ING-005)', () => {
  it('reads the WAV duration of the corpus fixtures', () => {
    expect(wavDurationMs(readFileSync(join(corpus, 'audio-fa-interview.wav')))).toBeCloseTo(
      5990,
      -1,
    );
  });

  it('maps an OpenAI-compatible verbose response to timed segments', async () => {
    const requests: { auth: string | undefined; body: string }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          auth: request.headers.authorization,
          body: Buffer.concat(chunks).toString('latin1'),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            language: 'fa',
            duration: 5.99,
            segments: [
              { start: 0, end: 2.5, text: ' سلام ', avg_logprob: -0.1 },
              { start: 2.5, end: 5.99, text: 'ادامه' },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const transcriber = new OpenAiCompatibleTranscriber(
        'test-key',
        `http://127.0.0.1:${port}/v1`,
        'whisper-1',
      );
      const transcript = await transcriber.transcribe(strToU8('RIFF'), 'audio/wav', 'fa');
      expect(transcript).toEqual({
        language: 'fa',
        durationMs: 5990,
        segments: [
          { startMs: 0, endMs: 2500, text: 'سلام', confidence: 0.905 },
          { startMs: 2500, endMs: 5990, text: 'ادامه' },
        ],
      });
      expect(requests[0]!.auth).toBe('Bearer test-key');
      expect(requests[0]!.body).toContain('verbose_json');
    } finally {
      server.close();
    }
  });
});

const hasTesseract = (() => {
  try {
    execFileSync('tesseract', ['--list-langs'], { stdio: 'pipe' });
    execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTesseract && !process.env['REQUIRE_OCR'])(
  'OCR acceptance on corpus v0 (ING-004)',
  () => {
    const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8')) as {
      items: {
        id: string;
        file: string;
        language: string;
        expected: {
          transcript: string;
          minCharacterAccuracy?: number;
          mustContain: string[];
          pages?: number;
        };
      }[];
    };
    for (const id of ['scan-fa-001', 'scan-en-001']) {
      it(`${id} meets the minimum character accuracy with page lineage`, async () => {
        const item = manifest.items.find((entry) => entry.id === id)!;
        const pdf = readFileSync(join(corpus, item.file));
        const pages = Array.from({ length: item.expected.pages ?? 1 }, (_, index) => index + 1);
        const results = await new TesseractOcr().recognizePdfPages(
          pdf,
          pages,
          item.language === 'fa' ? ['fas', 'eng'] : ['eng'],
        );
        expect([...results.keys()]).toEqual(pages);
        const text = pages.map((page) => results.get(page)!.text).join('\n');
        const expected = readFileSync(join(corpus, item.expected.transcript), 'utf8');
        const accuracy = characterAccuracy(text, expected);
        expect(accuracy, `${id} accuracy ${accuracy.toFixed(3)}`).toBeGreaterThanOrEqual(
          item.expected.minCharacterAccuracy!,
        );
        for (const phrase of item.expected.mustContain) {
          // OCR often drops the zero-width non-joiner between Persian word parts.
          expect(normalizeForSearch(text).replace(/ /gu, '')).toContain(
            normalizeForSearch(phrase).replace(/ /gu, ''),
          );
        }
      }, 120_000);
    }
  },
);

class MemoryStore implements IngestionStore {
  readonly segments = new Map<string, ExtractedSegment[]>();
  readonly audits: PipelineAudit[] = [];
  constructor(public version: StoredVersion & Record<string, unknown>) {}

  load(): Promise<StoredVersion | null> {
    return Promise.resolve(this.version);
  }

  transition(
    _w: string,
    _v: string,
    from: readonly SourceStatus[],
    patch: VersionPatch,
    audit: PipelineAudit | null,
  ): Promise<boolean> {
    if (!from.includes(this.version.status)) return Promise.resolve(false);
    this.version = { ...this.version, ...patch };
    if (audit) this.audits.push(audit);
    return Promise.resolve(true);
  }

  saveSegments(
    _w: string,
    versionId: string,
    segments: readonly ExtractedSegment[],
  ): Promise<void> {
    if (!this.segments.has(versionId)) this.segments.set(versionId, [...segments]);
    return Promise.resolve();
  }
}

const eicarScanner: MalwareScanner = {
  scan: (bytes) =>
    Promise.resolve(
      new TextDecoder().decode(bytes).includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
        ? { status: 'infected', engine: 'test', signature: 'Eicar-Test-Signature', detail: null }
        : { status: 'clean', engine: 'test', signature: null, detail: null },
    ),
};

const noOcr: OcrEngine = {
  id: 'none',
  recognizeImage: () => Promise.reject(new Error('unused')),
  recognizePdfPages: () => Promise.reject(new Error('unused')),
};

describe('pipeline (ING-002/003)', () => {
  const ids = { workspaceId: 'w1', assetId: 'a1', versionId: 'v1' };
  const setup = (
    bytes: Uint8Array,
    filename: string,
    declaredMime: string,
    extra: Partial<StoredVersion> = {},
  ) => {
    const objects = new MemoryObjectStore();
    void objects.put(
      objectKeys.quarantine(ids.workspaceId, ids.assetId, ids.versionId),
      bytes,
      declaredMime,
    );
    const store = new MemoryStore({
      id: ids.versionId,
      assetId: ids.assetId,
      kind: 'file',
      status: 'uploaded',
      objectKey: objectKeys.quarantine(ids.workspaceId, ids.assetId, ids.versionId),
      filename,
      declaredMime,
      declaredSize: bytes.length,
      declaredSha256: createHash('sha256').update(bytes).digest('hex'),
      originUrl: null,
      sniffedMime: null,
      ...extra,
    });
    const extract = vi.fn(async (data: Uint8Array, mime: string) => {
      const { extractStructured } = await import('./extract.js');
      return extractStructured(data, mime);
    });
    const deps = {
      store,
      objects,
      scanner: eicarScanner,
      extract,
      ocr: noOcr,
      transcriber: new UnconfiguredTranscriber(),
    };
    const input = {
      workspaceId: ids.workspaceId,
      versionId: ids.versionId,
      correlationId: 'c1',
      maxBytes: 1024 * 1024,
      language: 'en' as const,
    };
    return { objects, store, extract, deps, input };
  };

  it('keeps an infected file in quarantine and never parses it', async () => {
    const { store, extract, deps, input, objects } = setup(
      strToU8(EICAR),
      'eicar.txt',
      'text/plain',
    );
    expect(await runPipeline(input, deps)).toEqual({
      status: 'rejected',
      failureCode: 'malware_detected',
    });
    expect(extract).not.toHaveBeenCalled();
    expect(store.audits[0]).toMatchObject({
      action: 'source.rejected',
      severity: 'critical',
      securityRelevant: true,
    });
    expect(objects.objects.has(objectKeys.accepted('w1', 'a1', 'v1'))).toBe(false);
  });

  it('rejects a renamed executable and a checksum mismatch as security events', async () => {
    const exe = setup(new Uint8Array([0x4d, 0x5a, 1, 2, 3]), 'report.pdf', 'application/pdf');
    expect(await runPipeline(exe.input, exe.deps)).toMatchObject({
      failureCode: 'unsupported_type',
    });
    expect(exe.extract).not.toHaveBeenCalled();
    const tampered = setup(strToU8('hello world'), 'a.txt', 'text/plain', {
      declaredSha256: 'a'.repeat(64),
    });
    expect(await runPipeline(tampered.input, tampered.deps)).toMatchObject({
      failureCode: 'checksum_mismatch',
    });
    expect(tampered.store.audits[0]!.securityRelevant).toBe(true);
  });

  it('holds the file in quarantine when the scanner is unavailable', async () => {
    const { deps, input, extract, store } = setup(strToU8('plain'), 'a.txt', 'text/plain');
    const result = await runPipeline(input, {
      ...deps,
      scanner: {
        scan: () =>
          Promise.resolve({ status: 'error', engine: 'clamd', signature: null, detail: 'down' }),
      },
    });
    expect(result).toEqual({ status: 'quarantined', failureCode: 'scan_unavailable' });
    expect(extract).not.toHaveBeenCalled();
    expect(store.version.status).toBe('quarantined');
  });

  it('accepts, moves out of quarantine and indexes a clean document with lineage', async () => {
    const bytes = docx();
    const { deps, input, store, objects } = setup(
      bytes,
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(await runPipeline(input, deps)).toEqual({ status: 'indexed', failureCode: null });
    expect(objects.objects.has(objectKeys.quarantine('w1', 'a1', 'v1'))).toBe(false);
    expect(store.version).toMatchObject({
      status: 'indexed',
      objectKey: objectKeys.accepted('w1', 'a1', 'v1'),
    });
    expect(store.segments.get('v1')).toHaveLength(5);
    expect(store.audits.map((audit) => audit.action)).toEqual([
      'source.accepted',
      'source.extracted',
    ]);
    // Re-running a finished workflow is a no-op.
    expect(await runPipeline(input, deps)).toEqual({ status: 'indexed', failureCode: null });
  });

  it('marks audio partial when transcription is not configured', async () => {
    const wav = readFileSync(join(corpus, 'audio-en-note.wav'));
    const { deps, input, store } = setup(wav, 'note.wav', 'audio/wav');
    expect(await runPipeline(input, deps)).toEqual({ status: 'partial', failureCode: null });
    expect(store.version['extraction']).toMatchObject({
      warnings: ['transcription_not_configured'],
      method: 'transcription',
    });
  });
});
