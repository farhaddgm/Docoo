/** What the API returns about a project's business (ADR-0021); the shape of BusinessContent in @docoo/domain. */

export interface BusinessSection {
  key: string;
  content: string;
  source: 'ADMIN' | 'AI';
  reviewedAt: string | null;
  updatedAt: string | null;
}

export interface BusinessContent {
  business: {
    externalId: string;
    name: string;
    tagline: string;
    industry: string;
    website: string;
    location: string;
    language: string;
    status: string;
    updatedAt: string | null;
    gaps: string[];
    sources: { url: string; title: string }[];
  };
  sections: BusinessSection[];
  facts: {
    label: string;
    value: string;
    category: string;
    sourceUrl: string;
    note: string;
    source: 'ADMIN' | 'AI';
    verified: boolean;
    validUntil: string | null;
    isActive: boolean;
  }[];
  terms: {
    term: string;
    kind: 'USE' | 'AVOID';
    alternatives: string[];
    note: string;
    isActive: boolean;
  }[];
  notes: {
    text: string;
    status: string;
    summary: string;
    changedKeys: string[];
    isActive: boolean;
    createdAt: string;
  }[];
  references: {
    kind: string;
    url: string;
    title: string;
    status: string;
    isActive: boolean;
    fetchedAt: string | null;
    contentChars: number;
    excerpt: string;
  }[];
  assets: {
    kind: string;
    title: string;
    description: string;
    url: string;
    fileName: string | null;
    analysisStatus: string;
    analysis: Record<string, string | string[]> | null;
    excerpt: string;
    isActive: boolean;
    createdAt: string;
  }[];
  audit: {
    score: number | null;
    summary: string;
    strengths: string[];
    issues: {
      severity: string;
      status: string;
      type: string;
      target: string;
      title: string;
      detail: string;
      fix: string;
    }[];
    createdAt: string | null;
  } | null;
  health: {
    score: number;
    filled: number;
    total: number;
    checks: { id: string; level: 'ok' | 'warn' | 'todo'; count: number; keys: string[] }[];
  } | null;
  pendingSuggestions: number;
  topics: { id: string; title: string; status: string }[];
}

export interface SnapshotInfo {
  id: string;
  versionNo: number;
  name: string;
  contentSha256: string;
  changes: { sections: string[]; facts: boolean; terms: boolean; notes: boolean; details: boolean };
  exportedAt: string | null;
  fetchedAt: string;
}

export interface BusinessView {
  connection: { configured: boolean; status: string };
  link: {
    externalBusinessId: string;
    name: string;
    snapshotId: string;
    linkedAt: string;
    syncedAt: string | null;
    syncError: string | null;
    contenterUrl: string | null;
  } | null;
  snapshot: (SnapshotInfo & { content: BusinessContent }) | null;
  latestVersionNo?: number;
}

export interface HistoryItem extends SnapshotInfo {
  current: boolean;
  runs: number;
  writings: number;
}

export interface RolePreview {
  role: string;
  summary: {
    chars: number;
    budgetChars: number;
    sections: { key: string; chars: number; truncated: boolean; confirmed: boolean }[];
    omitted: string[];
    facts: number;
    terms: number;
    notes: number;
  } | null;
  data?: RoleBusinessData;
  rules?: string[];
}

export interface ContextPreview {
  linked: boolean;
  budgetChars: number;
  versionNo?: number;
  roles: RolePreview[];
}

export interface ContenterBusinessItem {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  website: string;
  location: string;
  language: string;
  status: string;
  filledSections: number;
  totalSections: number;
  topics: number;
  updatedAt: string | null;
}

/** The exact data one role is given (BusinessPromptData in @docoo/domain). */
export interface RoleBusinessData {
  name: string;
  tagline: string;
  industry: string;
  website: string;
  location: string;
  language: string;
  sections: { key: string; title: string; confirmed: boolean; text: string }[];
  keyFacts: {
    label: string;
    value: string;
    category: string;
    verified: boolean;
    validUntil: string | null;
  }[];
  terminology?: { term: string; rule: string; alternatives: string[] }[];
  adminNotes: string[];
  notIncluded: string[];
}
