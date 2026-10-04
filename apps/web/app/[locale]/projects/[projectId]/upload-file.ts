import { ApiError, apiSend } from '../../../api-client';
import type { Attachment } from './problem-types';

/** The file types the ingestion pipeline accepts (FR-ING-002), by extension. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
};

export const ACCEPTED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(',');

function mimeOf(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? file.type;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface UploadTicket {
  source: { id: string };
  version: { id: string };
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

/**
 * Sends a file as a source of the project (ING-001): declares it, uploads it straight to the
 * quarantine through the presigned URL and finalizes it, so scanning and extraction start.
 */
export async function uploadProjectFile(
  workspaceBase: string,
  projectId: string,
  file: File,
): Promise<Attachment> {
  const declared = await apiSend<UploadTicket>('POST', `${workspaceBase}/sources/uploads`, {
    title: file.name.slice(0, 300),
    filename: file.name,
    mime: mimeOf(file),
    size: file.size,
    sha256: await sha256Hex(file),
    scope: { type: 'project', id: projectId },
  });
  let stored: Response;
  try {
    stored = await fetch(declared.upload.url, {
      method: declared.upload.method,
      headers: declared.upload.headers,
      body: file,
    });
  } catch {
    throw new ApiError(0, 'ANALYSIS_UPLOAD_FAILED');
  }
  if (!stored.ok) throw new ApiError(stored.status, 'ANALYSIS_UPLOAD_FAILED');
  await apiSend(
    'POST',
    `${workspaceBase}/sources/${declared.source.id}/versions/${declared.version.id}/finalize`,
  );
  return { sourceId: declared.source.id, versionId: declared.version.id, title: file.name };
}
