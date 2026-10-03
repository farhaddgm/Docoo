import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { renderDocx, DOCX_TEMPLATE_VERSION, type RenderMeta } from './docx.js';
import { renderHtml } from './html.js';
import type { StructuredDocument } from './model.js';
import { renderPdf, PDF_TEMPLATE_VERSION } from './pdf.js';
import { renderPptx, PPTX_TEMPLATE_VERSION } from './pptx.js';

/** Bumped whenever rendering output changes for the same source version. */
export const RENDERER_VERSION = 'docoo-renderer-1.0.0';

export type ArtifactFormat = 'docx' | 'pdf' | 'pptx';

export const ARTIFACT_MIME: Record<ArtifactFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface ArtifactManifest {
  readonly format: ArtifactFormat;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly documentVersion: number;
  readonly rendererVersion: string;
  readonly templateVersion: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface RenderedArtifact {
  readonly bytes: Uint8Array;
  readonly manifest: ArtifactManifest;
}

export async function renderArtifact(
  format: ArtifactFormat,
  document: StructuredDocument,
  level: number,
  meta: RenderMeta & { documentVersionId: string },
): Promise<RenderedArtifact> {
  let bytes: Uint8Array;
  let templateVersion: string;
  if (format === 'docx') {
    bytes = renderDocx(document, meta);
    templateVersion = DOCX_TEMPLATE_VERSION;
  } else if (format === 'pptx') {
    bytes = renderPptx(document, level, meta).bytes;
    templateVersion = PPTX_TEMPLATE_VERSION;
  } else {
    bytes = await renderPdf(renderHtml(document, meta), meta);
    templateVersion = PDF_TEMPLATE_VERSION;
  }
  return {
    bytes,
    manifest: {
      format,
      documentId: meta.documentId,
      documentVersionId: meta.documentVersionId,
      documentVersion: meta.version,
      rendererVersion: RENDERER_VERSION,
      templateVersion,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    },
  };
}

function canonicalManifest(manifest: ArtifactManifest): string {
  return [
    manifest.format,
    manifest.documentId,
    manifest.documentVersionId,
    manifest.documentVersion,
    manifest.rendererVersion,
    manifest.templateVersion,
    manifest.sha256,
    manifest.sizeBytes,
  ].join('|');
}

/** HMAC-SHA256 over the manifest: proves an artifact came from this system for that version. */
export function signManifest(manifest: ArtifactManifest, key: string): string {
  return createHmac('sha256', key).update(canonicalManifest(manifest)).digest('hex');
}

export function verifyArtifact(
  bytes: Uint8Array,
  manifest: ArtifactManifest,
  signature: string,
  key: string,
): boolean {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== manifest.sha256 || bytes.length !== manifest.sizeBytes) return false;
  const expected = Buffer.from(signManifest(manifest, key), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
