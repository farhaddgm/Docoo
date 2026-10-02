import { createHash, randomUUID } from 'node:crypto';

import { normalizeExtractedText } from '@docoo/knowledge';

import { checkArchive } from './archive.js';
import { ExtractionError, type ExtractedSegment, type Extraction } from './extract.js';
import { checkMime, SUPPORTED_TYPES } from './mime.js';
import { objectKeys, ObjectTooLargeError, type ObjectStore } from './object-store.js';
import { ocrLanguages, type OcrEngine } from './ocr.js';
import type { MalwareScanner, ScanResult } from './scanner.js';
import { TranscriptionError, type Transcriber, wavDurationMs } from './transcription.js';
import { fetchUrl, htmlToText, UrlFetchError, type UrlPolicy } from './url-fetch.js';

export type SourceStatus =
  | 'uploaded'
  | 'quarantined'
  | 'scanning'
  | 'accepted'
  | 'extracting'
  | 'indexed'
  | 'rejected'
  | 'failed'
  | 'partial';

/** Input of the ingestion workflow; limits are resolved from settings when it starts. */
export interface IngestionInput {
  readonly workspaceId: string;
  readonly versionId: string;
  readonly correlationId: string;
  readonly maxBytes: number;
  readonly language: 'fa' | 'en' | null;
  readonly urlPolicy?: { readonly policy: UrlPolicy; readonly allowlist: readonly string[] };
}

export interface StoredVersion {
  readonly id: string;
  readonly assetId: string;
  readonly kind: 'file' | 'url' | 'text';
  readonly status: SourceStatus;
  readonly objectKey: string | null;
  readonly filename: string | null;
  readonly declaredMime: string | null;
  readonly declaredSize: number | null;
  readonly declaredSha256: string | null;
  readonly originUrl: string | null;
  readonly sniffedMime: string | null;
}

export interface VersionPatch {
  readonly status: SourceStatus;
  readonly sniffedMime?: string | null;
  readonly sizeBytes?: number | null;
  readonly sha256?: string | null;
  readonly objectKey?: string | null;
  readonly scan?: Record<string, unknown> | null;
  readonly extraction?: Record<string, unknown> | null;
  readonly failureCode?: string | null;
  readonly filename?: string | null;
}

export interface PipelineAudit {
  readonly action: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly securityRelevant: boolean;
  readonly after: Record<string, unknown>;
}

/** Persistence port of the pipeline; the PostgreSQL implementation runs under RLS. */
export interface IngestionStore {
  load(workspaceId: string, versionId: string): Promise<StoredVersion | null>;
  /** Applies the patch only if the version is still in one of `from`; returns success. */
  transition(
    workspaceId: string,
    versionId: string,
    from: readonly SourceStatus[],
    patch: VersionPatch,
    audit: PipelineAudit | null,
    correlationId: string,
  ): Promise<boolean>;
  /** Writes segments once; a retry after a crash keeps the first complete write. */
  saveSegments(
    workspaceId: string,
    versionId: string,
    segments: readonly ExtractedSegment[],
  ): Promise<void>;
}

export interface PipelineDependencies {
  readonly store: IngestionStore;
  readonly objects: ObjectStore;
  readonly scanner: MalwareScanner;
  readonly extract: (bytes: Uint8Array, mime: string) => Promise<Extraction>;
  readonly ocr: OcrEngine;
  readonly transcriber: Transcriber;
  readonly urlFetch?: typeof fetchUrl;
}

const FINAL_AFTER_SCAN: readonly SourceStatus[] = [
  'accepted',
  'extracting',
  'indexed',
  'partial',
  'rejected',
  'failed',
];
const AUDIO = new Set<string>([
  SUPPORTED_TYPES.mp3,
  SUPPORTED_TYPES.wav,
  SUPPORTED_TYPES.m4a,
  SUPPORTED_TYPES.ogg,
]);
const IMAGES = new Set<string>([SUPPORTED_TYPES.png, SUPPORTED_TYPES.jpg]);
const ZIPPED = new Set<string>([SUPPORTED_TYPES.docx, SUPPORTED_TYPES.pptx, SUPPORTED_TYPES.xlsx]);
/** Maximum audio duration accepted for transcription (05-document-pipeline §2). */
export const MAX_AUDIO_MS = 3 * 60 * 60 * 1000;
/** OCR confidence below which a page is kept but the version is marked partial. */
export const MIN_OCR_CONFIDENCE = 0.5;

export interface StepResult {
  readonly status: SourceStatus;
  readonly failureCode: string | null;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Step 1 (ING-002/ING-006): obtain the bytes (upload, URL snapshot or text), verify size and
 * checksum, sniff the real type, check archive limits and scan for malware. Only a clean,
 * consistent file is copied out of quarantine; anything else stays there and never reaches
 * a parser.
 */
export async function scanStep(
  input: IngestionInput,
  deps: PipelineDependencies,
): Promise<StepResult> {
  const version = await deps.store.load(input.workspaceId, input.versionId);
  if (!version) return { status: 'failed', failureCode: 'version_missing' };
  if (FINAL_AFTER_SCAN.includes(version.status)) {
    return { status: version.status, failureCode: null };
  }
  const quarantineKey = objectKeys.quarantine(input.workspaceId, version.assetId, version.id);
  const reject = async (
    code: string,
    extra: Partial<VersionPatch> = {},
    security = false,
    severity: PipelineAudit['severity'] = 'warning',
  ): Promise<StepResult> => {
    await deps.store.transition(
      input.workspaceId,
      version.id,
      ['uploaded', 'quarantined', 'scanning'],
      { status: 'rejected', failureCode: code, ...extra },
      {
        action: 'source.rejected',
        severity,
        securityRelevant: security,
        after: { versionId: version.id, failureCode: code, ...extra },
      },
      input.correlationId,
    );
    return { status: 'rejected', failureCode: code };
  };

  await deps.store.transition(
    input.workspaceId,
    version.id,
    ['uploaded', 'quarantined'],
    { status: 'scanning' },
    null,
    input.correlationId,
  );

  let bytes: Uint8Array;
  let declaredMime = version.declaredMime ?? 'application/octet-stream';
  let filename = version.filename ?? 'source';
  if (version.kind === 'url') {
    if (!version.originUrl || !input.urlPolicy) return reject('url_policy_missing');
    try {
      const fetched = await (deps.urlFetch ?? fetchUrl)(version.originUrl, {
        policy: input.urlPolicy.policy,
        allowlist: input.urlPolicy.allowlist,
        maxBytes: input.maxBytes,
      });
      bytes = fetched.bytes;
      declaredMime = fetched.contentType.split(';')[0]!.trim();
      filename = declaredMime === 'text/html' ? 'snapshot.html' : filenameFor(declaredMime);
      await deps.objects.put(quarantineKey, bytes, declaredMime);
    } catch (error) {
      if (error instanceof UrlFetchError) {
        const security = [
          'url_private_address',
          'url_not_allowlisted',
          'url_policy_denied',
        ].includes(error.code);
        return reject(error.code, {}, security, security ? 'critical' : 'warning');
      }
      throw error;
    }
  } else {
    try {
      bytes = await deps.objects.get(version.objectKey ?? quarantineKey, input.maxBytes);
    } catch (error) {
      if (error instanceof ObjectTooLargeError) return reject('file_too_large');
      const head = await deps.objects.head(version.objectKey ?? quarantineKey).catch(() => null);
      if (!head) return reject('object_missing');
      throw error;
    }
  }

  const size = bytes.length;
  const digest = sha256(bytes);
  if (size > input.maxBytes) return reject('file_too_large', { sizeBytes: size, sha256: digest });
  if (version.declaredSize !== null && version.declaredSize !== size) {
    return reject('size_mismatch', { sizeBytes: size, sha256: digest });
  }
  if (version.declaredSha256 && version.declaredSha256 !== digest) {
    return reject('checksum_mismatch', { sizeBytes: size, sha256: digest }, true);
  }

  let sniffedMime: string;
  if (version.kind === 'url' && declaredMime === 'text/html') {
    sniffedMime = 'text/html';
  } else {
    const mime = checkMime(bytes, filename, declaredMime);
    sniffedMime = mime.sniffedMime;
    if (!mime.accepted) {
      return reject(
        mime.problem!,
        { sizeBytes: size, sha256: digest, sniffedMime },
        true,
        'critical',
      );
    }
  }
  if (ZIPPED.has(sniffedMime)) {
    const archive = checkArchive(bytes);
    if (!archive.ok) {
      return reject(
        `archive_${archive.problem}`,
        { sizeBytes: size, sha256: digest, sniffedMime },
        true,
        'critical',
      );
    }
  }

  const scan: ScanResult = await deps.scanner.scan(bytes);
  const scanRecord = { ...scan, scannedAt: new Date().toISOString() };
  if (scan.status === 'infected') {
    return reject(
      'malware_detected',
      { sizeBytes: size, sha256: digest, sniffedMime, scan: scanRecord },
      true,
      'critical',
    );
  }
  if (scan.status !== 'clean') {
    // Fail closed: without a clean verdict the file stays in quarantine and can be retried.
    await deps.store.transition(
      input.workspaceId,
      version.id,
      ['scanning'],
      {
        status: 'quarantined',
        sizeBytes: size,
        sha256: digest,
        sniffedMime,
        scan: scanRecord,
        failureCode: 'scan_unavailable',
      },
      {
        action: 'source.scan_unavailable',
        severity: 'warning',
        securityRelevant: true,
        after: { versionId: version.id, engine: scan.engine },
      },
      input.correlationId,
    );
    return { status: 'quarantined', failureCode: 'scan_unavailable' };
  }

  const acceptedKey = objectKeys.accepted(input.workspaceId, version.assetId, version.id);
  await deps.objects.copy(quarantineKey, acceptedKey);
  await deps.objects.delete(quarantineKey);
  await deps.store.transition(
    input.workspaceId,
    version.id,
    ['scanning'],
    {
      status: 'accepted',
      sizeBytes: size,
      sha256: digest,
      sniffedMime,
      scan: scanRecord,
      objectKey: acceptedKey,
      failureCode: null,
      filename,
    },
    {
      action: 'source.accepted',
      severity: 'info',
      securityRelevant: false,
      after: {
        versionId: version.id,
        sha256: digest,
        sizeBytes: size,
        sniffedMime,
        engine: scan.engine,
      },
    },
    input.correlationId,
  );
  return { status: 'accepted', failureCode: null };
}

function filenameFor(mime: string): string {
  const entry = Object.entries(SUPPORTED_TYPES).find(([, value]) => value === mime);
  return `snapshot.${entry?.[0] ?? 'bin'}`;
}

/**
 * Step 2 (ING-003/004/005): parse in the sandbox, OCR scanned pages and images, transcribe
 * audio, and store every segment with its locator (lineage to page, slide, cell, line or
 * time range of the original file).
 */
export async function extractStep(
  input: IngestionInput,
  deps: PipelineDependencies,
): Promise<StepResult> {
  const version = await deps.store.load(input.workspaceId, input.versionId);
  if (!version) return { status: 'failed', failureCode: 'version_missing' };
  if (['indexed', 'partial', 'failed', 'rejected'].includes(version.status)) {
    return { status: version.status, failureCode: null };
  }
  if (version.status !== 'accepted' && version.status !== 'extracting') {
    return { status: version.status, failureCode: 'not_accepted' };
  }
  await deps.store.transition(
    input.workspaceId,
    version.id,
    ['accepted'],
    { status: 'extracting' },
    null,
    input.correlationId,
  );
  const mime = version.sniffedMime ?? 'application/octet-stream';
  const bytes = await deps.objects.get(version.objectKey!, input.maxBytes);
  const warnings: string[] = [];
  const details: Record<string, unknown> = { mime };
  let segments: ExtractedSegment[] = [];
  let partial = false;

  try {
    if (AUDIO.has(mime)) {
      details['method'] = 'transcription';
      details['transcriber'] = deps.transcriber.id;
      const duration = mime === SUPPORTED_TYPES.wav ? wavDurationMs(bytes) : null;
      if (duration !== null) details['durationMs'] = duration;
      if (duration !== null && duration > MAX_AUDIO_MS) throw new ExtractionError('audio_too_long');
      try {
        const transcript = await deps.transcriber.transcribe(bytes, mime, input.language);
        segments = transcript.segments
          .filter((segment) => segment.text.trim())
          .map((segment) => ({
            locator: { startMs: segment.startMs, endMs: segment.endMs },
            text: normalizeExtractedText(segment.text),
            ...(segment.confidence === undefined ? {} : { confidence: segment.confidence }),
          }));
        details['language'] = transcript.language;
      } catch (error) {
        if (!(error instanceof TranscriptionError)) throw error;
        warnings.push(error.code);
        partial = true;
      }
    } else if (IMAGES.has(mime)) {
      details['method'] = 'ocr';
      details['ocrEngine'] = deps.ocr.id;
      const result = await deps.ocr.recognizeImage(bytes, ocrLanguages(input.language));
      details['meanConfidence'] = result.confidence;
      const text = normalizeExtractedText(result.text);
      if (text) segments = [{ locator: { image: 1, ocr: 1 }, text, confidence: result.confidence }];
      if (!result.text || result.confidence < MIN_OCR_CONFIDENCE) {
        warnings.push('ocr_low_confidence');
        partial = true;
      }
    } else {
      const parseMime = mime === 'text/html' ? SUPPORTED_TYPES.txt : mime;
      const parseBytes =
        mime === 'text/html'
          ? new TextEncoder().encode(htmlToText(new TextDecoder().decode(bytes)).text)
          : bytes;
      const extraction = await deps.extract(parseBytes, parseMime);
      details['method'] = 'text-layer';
      details['sandbox'] = 'node-permission';
      if (extraction.pageCount !== undefined) details['pageCount'] = extraction.pageCount;
      segments = [...extraction.segments];
      warnings.push(...extraction.warnings);
      if (extraction.truncated) {
        warnings.push('segments_truncated');
        partial = true;
      }
      if (extraction.pagesNeedingOcr.length > 0) {
        details['ocrEngine'] = deps.ocr.id;
        details['ocrPages'] = extraction.pagesNeedingOcr;
        const pages = await deps.ocr.recognizePdfPages(
          bytes,
          extraction.pagesNeedingOcr,
          ocrLanguages(input.language),
        );
        const confidences: number[] = [];
        for (const page of extraction.pagesNeedingOcr) {
          const result = pages.get(page);
          if (!result?.text) {
            warnings.push(`ocr_failed_page_${page}`);
            partial = true;
            continue;
          }
          confidences.push(result.confidence);
          if (result.confidence < MIN_OCR_CONFIDENCE) {
            warnings.push(`ocr_low_confidence_page_${page}`);
            partial = true;
          }
          segments.push({
            locator: { page, ocr: 1 },
            text: normalizeExtractedText(result.text),
            confidence: result.confidence,
          });
        }
        if (confidences.length > 0) {
          details['meanConfidence'] =
            Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000;
        }
        segments.sort((a, b) => Number(a.locator['page'] ?? 0) - Number(b.locator['page'] ?? 0));
      }
    }
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : 'extraction_failed';
    await deps.store.transition(
      input.workspaceId,
      version.id,
      ['extracting'],
      { status: 'failed', failureCode: code, extraction: { ...details, warnings } },
      {
        action: 'source.extraction_failed',
        severity: 'warning',
        securityRelevant: false,
        after: { versionId: version.id, failureCode: code },
      },
      input.correlationId,
    );
    return { status: 'failed', failureCode: code };
  }

  if (segments.length === 0 && !partial) {
    warnings.push('no_text');
    partial = true;
  }
  await deps.store.saveSegments(input.workspaceId, version.id, segments);
  const status: SourceStatus = partial ? 'partial' : 'indexed';
  await deps.store.transition(
    input.workspaceId,
    version.id,
    ['extracting'],
    {
      status,
      failureCode: null,
      extraction: { ...details, warnings, segmentCount: segments.length },
    },
    {
      action: 'source.extracted',
      severity: partial ? 'warning' : 'info',
      securityRelevant: false,
      after: { versionId: version.id, status, segmentCount: segments.length, warnings },
    },
    input.correlationId,
  );
  return { status, failureCode: null };
}

/** Runs both steps in-process (tests and the inline dispatcher). */
export async function runPipeline(
  input: IngestionInput,
  deps: PipelineDependencies,
): Promise<StepResult> {
  const scanned = await scanStep(input, deps);
  if (scanned.status !== 'accepted') return scanned;
  return extractStep(input, deps);
}

export function newCorrelationId(): string {
  return randomUUID();
}
