import { ApiError, apiSend } from '../../api-client';

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
  source: { id: string; version: number };
  version: { id: string };
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
}

export interface UploadedSource {
  sourceId: string;
  versionId: string;
}

export type UploadTarget =
  | { kind: 'new'; title: string; scope: { type: string; id: string } }
  | { kind: 'version'; sourceId: string; sourceVersion: number; reason?: string };

/**
 * Sends a file as a source (ING-001): declares it, uploads it straight to the quarantine
 * through the presigned URL and finalizes it, so scanning and extraction start. A failure of the
 * direct upload carries `failureCode` so each screen can word it.
 */
export async function uploadSourceFile(
  workspaceBase: string,
  file: File,
  target: UploadTarget,
  failureCode: string,
): Promise<UploadedSource> {
  const declaration = {
    filename: file.name,
    mime: mimeOf(file),
    size: file.size,
    sha256: await sha256Hex(file),
  };
  const declared =
    target.kind === 'new'
      ? await apiSend<UploadTicket>('POST', `${workspaceBase}/sources/uploads`, {
          title: target.title.slice(0, 300),
          scope: target.scope,
          ...declaration,
        })
      : await apiSend<UploadTicket>(
          'POST',
          `${workspaceBase}/sources/${target.sourceId}/versions`,
          { ...declaration, ...(target.reason ? { reason: target.reason } : {}) },
          { version: target.sourceVersion },
        );
  let stored: Response;
  try {
    stored = await fetch(declared.upload.url, {
      method: declared.upload.method,
      headers: declared.upload.headers,
      body: file,
    });
  } catch {
    throw new ApiError(0, failureCode);
  }
  if (!stored.ok) throw new ApiError(stored.status, failureCode);
  await apiSend(
    'POST',
    `${workspaceBase}/sources/${declared.source.id}/versions/${declared.version.id}/finalize`,
  );
  return { sourceId: declared.source.id, versionId: declared.version.id };
}
