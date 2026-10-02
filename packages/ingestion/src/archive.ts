import { unzipSync } from 'fflate';

export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxExpandedBytes: number;
  readonly maxRatio: number;
}

/** Archive-bomb limits for Office Open XML containers (05-document-pipeline §2). */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 5_000,
  maxExpandedBytes: 300 * 1024 * 1024,
  maxRatio: 200,
};

export interface ArchiveCheck {
  readonly ok: boolean;
  readonly entries: number;
  readonly expandedBytes: number;
  readonly problem:
    'too_many_entries' | 'expanded_too_large' | 'compression_ratio' | 'corrupt' | null;
}

/** Reads only the zip directory (declared sizes); no entry is inflated. */
export function checkArchive(bytes: Uint8Array, limits = DEFAULT_ARCHIVE_LIMITS): ArchiveCheck {
  let entries = 0;
  let expandedBytes = 0;
  let worstRatio = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        expandedBytes += file.originalSize;
        if (file.size > 0) worstRatio = Math.max(worstRatio, file.originalSize / file.size);
        else if (file.originalSize > 0) worstRatio = Number.POSITIVE_INFINITY;
        return false;
      },
    });
  } catch {
    return { ok: false, entries, expandedBytes, problem: 'corrupt' };
  }
  const problem =
    entries > limits.maxEntries
      ? 'too_many_entries'
      : expandedBytes > limits.maxExpandedBytes
        ? 'expanded_too_large'
        : worstRatio > limits.maxRatio
          ? 'compression_ratio'
          : null;
  return { ok: problem === null, entries, expandedBytes, problem };
}
