import { createHash } from 'node:crypto';

export interface CitationInput {
  readonly sourceRef?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly publisher?: string | null | undefined;
  readonly author?: string | null | undefined;
  readonly publishedAt?: string | null | undefined;
  readonly accessedAt?: string | null | undefined;
  readonly locator?: string | null | undefined;
  readonly quote?: string | null | undefined;
}

/** Fields a machine-research citation must carry (03-knowledge-and-brain §6, KNO-006). */
export const REQUIRED_CITATION_FIELDS = [
  'sourceRef',
  'title',
  'publisher',
  'publishedAt',
  'accessedAt',
] as const;

export type RequiredCitationField = (typeof REQUIRED_CITATION_FIELDS)[number];

export interface CitationAssessment {
  readonly complete: boolean;
  readonly missingFields: RequiredCitationField[];
  /** SHA-256 of the quote; the quote itself is not stored. */
  readonly quoteDigest: string | null;
}

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value: string | null | undefined): boolean {
  return present(value) && !Number.isNaN(Date.parse(value!));
}

export function assessCitation(citation: CitationInput): CitationAssessment {
  const missingFields = REQUIRED_CITATION_FIELDS.filter((field) =>
    field === 'publishedAt' || field === 'accessedAt'
      ? !validDate(citation[field])
      : !present(citation[field]),
  );
  return {
    complete: missingFields.length === 0,
    missingFields,
    quoteDigest: present(citation.quote)
      ? createHash('sha256').update(citation.quote!.normalize('NFC')).digest('hex')
      : null,
  };
}
