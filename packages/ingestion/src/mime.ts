import { unzipSync } from 'fflate';

/** File types the ingestion pipeline accepts (docs/04-architecture/05-document-pipeline.md §2). */
export const SUPPORTED_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
} as const;

export type SupportedExtension = keyof typeof SUPPORTED_TYPES;
export type SupportedMime = (typeof SUPPORTED_TYPES)[SupportedExtension];

const EXTENSION_ALIASES: Record<string, SupportedExtension> = {
  jpeg: 'jpg',
  markdown: 'md',
  oga: 'ogg',
};

export function extensionOf(filename: string): SupportedExtension | null {
  const match = /\.([a-z0-9]+)$/iu.exec(filename.trim());
  if (!match) return null;
  const raw = match[1]!.toLowerCase();
  const extension = EXTENSION_ALIASES[raw] ?? raw;
  return extension in SUPPORTED_TYPES ? (extension as SupportedExtension) : null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
}

/** Office Open XML subtype from the zip entry names, without inflating any entry. */
function officeType(bytes: Uint8Array): SupportedMime | 'application/zip' {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return 'application/zip';
  }
  if (!names.includes('[Content_Types].xml')) return 'application/zip';
  if (names.some((name) => name.startsWith('word/'))) return SUPPORTED_TYPES.docx;
  if (names.some((name) => name.startsWith('ppt/'))) return SUPPORTED_TYPES.pptx;
  if (names.some((name) => name.startsWith('xl/'))) return SUPPORTED_TYPES.xlsx;
  return 'application/zip';
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The real type of a file from its content (magic bytes), independent of the declared type
 * and file name (ING-002). Returns `application/octet-stream` for anything unrecognised.
 */
export function sniffMime(bytes: Uint8Array, filename = ''): string {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return SUPPORTED_TYPES.pdf;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return officeType(bytes);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return SUPPORTED_TYPES.png;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return SUPPORTED_TYPES.jpg;
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return SUPPORTED_TYPES.wav;
  if (ascii(bytes, 0, 4) === 'OggS') return SUPPORTED_TYPES.ogg;
  if (ascii(bytes, 4, 8) === 'ftyp' && /^(M4A |mp42|isom|M4B )$/u.test(ascii(bytes, 8, 12))) {
    return SUPPORTED_TYPES.m4a;
  }
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) {
    return SUPPORTED_TYPES.mp3;
  }
  if (startsWith(bytes, [0x4d, 0x5a]) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return 'application/x-executable';
  }
  const sample = bytes.subarray(0, 64 * 1024);
  if (isUtf8Text(sample.length === bytes.length ? bytes : trimPartialUtf8(sample))) {
    const extension = extensionOf(filename);
    if (extension === 'json') {
      try {
        JSON.parse(new TextDecoder().decode(bytes));
        return SUPPORTED_TYPES.json;
      } catch {
        return SUPPORTED_TYPES.txt;
      }
    }
    if (extension === 'csv') return SUPPORTED_TYPES.csv;
    if (extension === 'md') return SUPPORTED_TYPES.md;
    return SUPPORTED_TYPES.txt;
  }
  return 'application/octet-stream';
}

/** Drops a multi-byte sequence cut at the end of a sample. */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  const end = bytes.length;
  for (let back = 1; back <= 3 && end - back >= 0; back += 1) {
    const byte = bytes[end - back]!;
    if ((byte & 0xc0) === 0xc0) return bytes.subarray(0, end - back);
    if ((byte & 0x80) === 0) break;
  }
  return bytes.subarray(0, end);
}

const TEXT_FAMILY = new Set<string>([SUPPORTED_TYPES.txt, SUPPORTED_TYPES.csv, SUPPORTED_TYPES.md]);

export interface MimeCheck {
  readonly sniffedMime: string;
  readonly accepted: boolean;
  /** Why the file is held in quarantine, when it is. */
  readonly problem: 'unsupported_type' | 'mime_mismatch' | 'extension_mismatch' | null;
}

/**
 * The declared type, the file extension and the sniffed content must agree. Plain-text
 * family members may stand in for each other because they share the same bytes.
 */
export function checkMime(bytes: Uint8Array, filename: string, declaredMime: string): MimeCheck {
  const sniffedMime = sniffMime(bytes, filename);
  const supported = Object.values(SUPPORTED_TYPES) as string[];
  if (!supported.includes(sniffedMime)) {
    return { sniffedMime, accepted: false, problem: 'unsupported_type' };
  }
  const declared = declaredMime.split(';')[0]!.trim().toLowerCase();
  const same = (a: string, b: string): boolean =>
    a === b ||
    (TEXT_FAMILY.has(a) && TEXT_FAMILY.has(b)) ||
    (a === 'audio/x-wav' && b === SUPPORTED_TYPES.wav);
  if (!same(declared, sniffedMime))
    return { sniffedMime, accepted: false, problem: 'mime_mismatch' };
  const extension = extensionOf(filename);
  if (!extension || !same(SUPPORTED_TYPES[extension], sniffedMime)) {
    return { sniffedMime, accepted: false, problem: 'extension_mismatch' };
  }
  return { sniffedMime, accepted: true, problem: null };
}
