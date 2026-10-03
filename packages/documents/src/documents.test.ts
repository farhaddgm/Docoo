import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  checkCompliance,
  countCharacters,
  countDocument,
  criteriaProblem,
  decideEvaluation,
  DEFAULT_CRITERIA,
  diffDocuments,
  DocumentValidationError,
  planSlides,
  renderArtifact,
  renderDocx,
  renderHtml,
  renderPptx,
  rubricProblem,
  scoreSolution,
  signManifest,
  SlideOverflowError,
  SYSTEM_RUBRIC,
  validateDocument,
  verifyArtifact,
  type StructuredDocument,
} from './index.js';

const meta = {
  documentId: 'doc-1',
  version: 3,
  createdAt: '2026-10-01T10:00:00Z',
  documentVersionId: 'ver-3',
};

const persian: StructuredDocument = {
  title: 'کاهش ریزش مشتری',
  language: 'fa',
  blocks: [
    { type: 'heading', id: 'h1', level: 1, text: 'مسئله' },
    {
      type: 'paragraph',
      id: 'p1',
      runs: [{ text: 'ریزش مشتری ۲۰٪ افزایش یافت.', citations: ['r1'] }],
    },
    { type: 'heading', id: 'h2', level: 1, text: 'راه‌حل' },
    { type: 'list', id: 'l1', ordered: false, items: ['برنامهٔ وفاداری', 'پیگیری پس از خرید'] },
    {
      type: 'table',
      id: 't1',
      caption: 'هزینه‌ها',
      columns: ['مورد', 'مبلغ'],
      rows: [['آموزش', '۱۰']],
    },
    {
      type: 'chart',
      id: 'c1',
      kind: 'bar',
      title: 'ریزش',
      unit: 'درصد',
      source: 'گزارش داخلی',
      alt: 'نمودار ریزش',
      labels: ['۱۴۰۲', '۱۴۰۳'],
      values: [12, 20],
    },
    {
      type: 'bibliography',
      id: 'b1',
      entries: [{ id: 'r1', text: 'گزارش فروش ۱۴۰۳', url: 'https://example.org/r' }],
    },
  ],
};

describe('structured model and counting (DOC-101)', () => {
  it('counts only Unicode letters and numbers after NFC', () => {
    expect(countCharacters('Docoo 2.0!')).toBe(7);
    expect(countCharacters('می‌شود')).toBe(5);
    expect(countCharacters('é')).toBe(1);
    expect(countCharacters('سَلام')).toBe(4);
  });

  it('counts visible text, including citation labels but not URLs', () => {
    const { count, algorithm } = countDocument(persian);
    expect(algorithm).toBe('unicode-letter-number-v1');
    expect(count).toBe(
      countCharacters(
        [
          'کاهش ریزش مشتری',
          'مسئله',
          'ریزش مشتری ۲۰٪ افزایش یافت.',
          '[1]',
          'راه‌حل',
          'برنامهٔ وفاداری',
          'پیگیری پس از خرید',
          'هزینه‌ها',
          'مورد',
          'مبلغ',
          'آموزش',
          '۱۰',
          'ریزش',
          'نمودار ریزش',
          'درصد',
          'گزارش داخلی',
          '۱۴۰۲',
          '۱۴۰۳',
          '12',
          '20',
          'گزارش فروش ۱۴۰۳',
        ].join(''),
      ),
    );
  });

  it('rejects unknown blocks, broken tables, untraceable charts and unresolved citations', () => {
    const invalid = {
      title: 'x',
      language: 'en',
      blocks: [
        { type: 'video', id: 'v' },
        { type: 'table', id: 't', caption: 'c', columns: ['a', 'b'], rows: [['1']] },
        {
          type: 'chart',
          id: 'c',
          kind: 'bar',
          title: 't',
          unit: 'u',
          source: 's',
          alt: 'a',
          labels: ['a'],
          values: [],
        },
        { type: 'paragraph', id: 'p', runs: [{ text: 'x', citations: ['missing'] }] },
        { type: 'paragraph', id: 'p', runs: [] },
      ],
    };
    try {
      validateDocument(invalid);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      const problems = (error as DocumentValidationError).problems.join('\n');
      expect(problems).toContain('unknown block type "video"');
      expect(problems).toContain('one text cell per column');
      expect(problems).toContain('traceable data');
      expect(problems).toContain('citation missing');
      expect(problems).toContain('duplicate id p');
    }
    expect(validateDocument(persian)).toBe(persian);
  });

  it('checks the length level bounds', () => {
    const compliance = checkCompliance(persian, 1);
    expect(compliance).toMatchObject({
      level: 1,
      withinBounds: false,
      bounds: { min: 1000, max: 3000 },
    });
    expect(compliance.deviation).toBeLessThan(0);
    const long: StructuredDocument = {
      ...persian,
      blocks: [{ type: 'paragraph', id: 'p', runs: [{ text: 'a'.repeat(1500) }] }],
    };
    expect(checkCompliance(long, 1).withinBounds).toBe(true);
    expect(checkCompliance(long, 2).withinBounds).toBe(false);
  });
});

describe('versions and diff (DOC-102)', () => {
  it('reports added, removed, changed and moved blocks', () => {
    const after: StructuredDocument = {
      ...persian,
      title: 'عنوان تازه',
      blocks: [
        persian.blocks[2]!,
        { type: 'heading', id: 'h1', level: 1, text: 'مسئلهٔ اصلی' },
        persian.blocks[3]!,
        { type: 'callout', id: 'n1', tone: 'decision', text: 'تصمیم' },
      ],
    };
    const diff = diffDocuments(persian, after);
    expect(diff.titleChanged).toBe(true);
    expect(diff.summary).toEqual({ added: 1, removed: 4, changed: 1, moved: 2 });
  });
});

describe('renderers and artifacts (DOC-103)', () => {
  it('renders a deterministic DOCX with headings, header rows, RTL and metadata', () => {
    const first = renderDocx(persian, meta);
    expect(renderDocx(persian, meta)).toEqual(first);
    const files = unzipSync(first);
    const body = strFromU8(files['word/document.xml']!);
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain('<w:tblHeader/>');
    expect(body).toContain('<w:bidi/>');
    expect(body).toContain('[1]');
    const core = strFromU8(files['docProps/core.xml']!);
    expect(core).toContain('<dc:identifier>doc-1</dc:identifier>');
    expect(core).toContain('<cp:version>3</cp:version>');
  });

  it('renders a management-summary PPTX and fails on overflow', () => {
    const { bytes, slides } = renderPptx(persian, 3, meta);
    expect(slides.map((slide) => slide.title)).toEqual(['کاهش ریزش مشتری', 'مسئله', 'راه‌حل']);
    const files = unzipSync(bytes);
    expect(
      Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)),
    ).toHaveLength(3);
    expect(strFromU8(files['ppt/slides/slide2.xml']!)).toContain('rtl="1"');
    const overflowing: StructuredDocument = {
      title: 'x',
      language: 'en',
      blocks: [
        { type: 'heading', id: 'h', level: 1, text: 'Section' },
        { type: 'list', id: 'l', ordered: false, items: ['x'.repeat(300)] },
      ],
    };
    expect(() => planSlides(overflowing, 3)).toThrow(SlideOverflowError);
  });

  it('signs artifacts and detects tampering', async () => {
    const artifact = await renderArtifact('docx', persian, 2, meta);
    expect(artifact.manifest).toMatchObject({
      format: 'docx',
      documentVersionId: 'ver-3',
      documentVersion: 3,
      rendererVersion: 'docoo-renderer-1.0.0',
    });
    expect(artifact.manifest.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const signature = signManifest(artifact.manifest, 'signing-key');
    expect(verifyArtifact(artifact.bytes, artifact.manifest, signature, 'signing-key')).toBe(true);
    const tampered = new Uint8Array(artifact.bytes);
    tampered[100] = (tampered[100]! + 1) % 256;
    expect(verifyArtifact(tampered, artifact.manifest, signature, 'signing-key')).toBe(false);
    expect(
      verifyArtifact(
        artifact.bytes,
        { ...artifact.manifest, documentVersion: 4 },
        signature,
        'signing-key',
      ),
    ).toBe(false);
    expect(verifyArtifact(artifact.bytes, artifact.manifest, signature, 'other-key')).toBe(false);
  });

  it('escapes content in the print HTML', () => {
    const html = renderHtml(
      { title: '<script>alert(1)</script>', language: 'en', blocks: [] },
      meta,
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('dir="ltr"');
  });

  it.skipIf(!process.env['RENDER_PDF'])(
    'renders a PDF in Chromium with page numbers',
    async () => {
      const artifact = await renderArtifact('pdf', persian, 1, meta);
      expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe('%PDF-');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: artifact.bytes }).promise;
      expect(pdf.numPages).toBeGreaterThanOrEqual(1);
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(text).toContain('doc-1');
    },
    60_000,
  );
});

describe('solution scoring (SOL-002)', () => {
  it('requires enabled weights to sum to 100 and explains every score', () => {
    expect(criteriaProblem(DEFAULT_CRITERIA)).toBeNull();
    expect(
      criteriaProblem(
        DEFAULT_CRITERIA.map((criterion, index) =>
          index === 0 ? { ...criterion, enabled: false } : criterion,
        ),
      ),
    ).toContain('add up to 100');
    const score = scoreSolution(
      { impact: 5, feasibility: 4, evidence: 3, cost: 2, risk: 4, time: 5 },
      DEFAULT_CRITERIA,
    );
    expect(score.criteria[0]).toEqual({
      key: 'impact',
      label: 'Impact on the problem',
      raw: 5,
      max: 5,
      weight: 25,
      weighted: 25,
      explanation: '5/5 × 25 = 25.00',
    });
    expect(score.total).toBe(25 + 16 + 9 + 6 + 12 + 10);
  });
});

describe('evaluation (EVA-001/002)', () => {
  const allScores = (score: number) =>
    SYSTEM_RUBRIC.criteria.map((criterion) => ({
      criterion: criterion.key,
      score,
      evidence: `evidence for ${criterion.key}`,
    }));

  it('has a valid system rubric', () => {
    expect(rubricProblem(SYSTEM_RUBRIC)).toBeNull();
  });

  it('passes good work and records evidence per dimension', () => {
    const result = decideEvaluation(SYSTEM_RUBRIC, allScores(90), [], {
      ok: true,
      problems: [],
      location: 'document',
    });
    expect(result.status).toBe('passed');
    expect(result.overall).toBe(90.5);
    expect(result.scores.every((score) => score.evidence.length > 0)).toBe(true);
  });

  it('fails compliance and low minimums with findings and target stages', () => {
    const compliance = decideEvaluation(SYSTEM_RUBRIC, allScores(95), [], {
      ok: false,
      problems: ['below level bounds'],
      location: 'document',
    });
    expect(compliance.status).toBe('failed_compliance');
    expect(compliance.findings).toEqual([
      expect.objectContaining({
        severity: 'high',
        criterion: 'format_compliance',
        targetStage: 'documentation',
      }),
    ]);
    const weakEvidence = decideEvaluation(
      SYSTEM_RUBRIC,
      allScores(95).map((score) =>
        score.criterion === 'evidence' ? { ...score, score: 40 } : score,
      ),
      [],
      { ok: true, problems: [], location: 'document' },
    );
    expect(weakEvidence.status).toBe('failed_quality');
    expect(weakEvidence.findings[0]).toMatchObject({
      criterion: 'evidence',
      targetStage: 'research',
    });
  });
});
