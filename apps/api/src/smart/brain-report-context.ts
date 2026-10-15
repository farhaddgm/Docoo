/**
 * The Brain report section of the Smart snapshot. The model has no tools, so code looks the
 * report up (read-only, under the administrator's own RLS and permission) and hands over a
 * bounded, content-free view of it. Deviations and recommendations are produced by fixed rules
 * (docs/adr/0011) and carry ids and counts only; the free text written by the evaluating model
 * (`summary`, finding `detail` and `recommendation`) can paraphrase stage outputs, so it stays
 * out, and the section says so instead of letting the assistant guess.
 */

export const BRAIN_SECTION_LIMIT = 16_000;
const RECENT_LIMIT = 10;
const DETAIL_LIMIT = 300;
const EVIDENCE_PER_ITEM = 5;
const LIST_LIMIT = 40;

/** `/fa/brain`, `/en/brain` and anything below them. */
const BRAIN_ROUTE = /^\/[a-z]{2}\/brain(?:[/?#]|$)/i;

export function isBrainRoute(route: string): boolean {
  return BRAIN_ROUTE.test(route);
}

export interface BrainReportRow {
  readonly id: string;
  readonly scope: string;
  readonly projectId: string | null;
  readonly charterVersion: string;
  readonly periodFrom: string | null;
  readonly periodTo: string;
  readonly createdAt: string;
  readonly summary: unknown;
  readonly deviations: unknown;
  readonly recommendations: unknown;
  readonly evaluations: unknown;
}

export interface BrainReportListRow {
  readonly id: string;
  readonly scope: string;
  readonly projectId: string | null;
  readonly createdAt: string;
  readonly deviations: number;
  readonly high: number;
}

export type BrainReportLookup =
  /** The user asked about the Brain page but no report is open there. */
  | { readonly status: 'none_selected' }
  /** The administrator's role cannot read Brain reports (`knowledge.read`). */
  | { readonly status: 'forbidden' }
  /** The id is not a report of this workspace. */
  | { readonly status: 'not_found' }
  | { readonly status: 'available'; readonly report: BrainReportRow };

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(asRecord) : [];
const text = (value: unknown, limit = DETAIL_LIMIT): string | null =>
  typeof value === 'string' ? value.slice(0, limit) : null;
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function evidenceOf(value: unknown, perItem: number) {
  const list = asList(value);
  return {
    count: list.length,
    items: list.slice(0, perItem).map((item) => ({ type: text(item['type'], 60), id: item['id'] })),
  };
}

function reportView(row: BrainReportRow, perItem: number, listLimit: number) {
  const deviations = asList(row.deviations);
  const recommendations = asList(row.recommendations);
  const summary = asRecord(row.summary);
  const evaluations = asList(row.evaluations);
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.projectId,
    charterVersion: row.charterVersion,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    createdAt: row.createdAt,
    totals: summary['totals'] ?? null,
    roles: asList(summary['roles']).map((role) => ({
      stage: role['stage'],
      role: role['role'],
      deviations: role['deviations'],
      invocations: role['invocations'],
      costUsd: role['costUsd'],
      avgLatencyMs: role['avgLatencyMs'],
      retries: role['retries'],
    })),
    deviations: deviations.slice(0, listLimit).map((item) => ({
      rule: text(item['rule'], 80),
      clause: text(item['clause'], 80),
      role: text(item['role'], 40),
      severity: text(item['severity'], 20),
      count: number(item['count']),
      detail: text(item['detail']),
      evidence: evidenceOf(item['evidence'], perItem),
    })),
    recommendations: recommendations.slice(0, listLimit).map((item) => ({
      rule: text(item['rule'], 80),
      target: text(item['target'], 40),
      action: text(item['action']),
    })),
    modelEvaluation: {
      requested: summary['modelEvaluation'] !== undefined || evaluations.length > 0,
      summary: summary['modelEvaluation'] ?? null,
      roles: evaluations.map((item) => ({
        role: text(item['role'], 40),
        stage: text(item['stage'], 40),
        status: text(item['status'], 20),
        reason: text(item['reason'], 60),
        score: number(item['score']),
        findings: asList(item['findings']).map((finding) => ({
          kind: text(finding['kind'], 60),
          severity: text(finding['severity'], 20),
        })),
      })),
      /** Written by the evaluating model; not given to Smart (docs/01-product/06-smart.md). */
      freeTextIncluded: false,
    },
    truncated:
      deviations.length > listLimit || recommendations.length > listLimit ? true : undefined,
  };
}

/** JSON that cannot close the surrounding `<context>` element. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * `{"brainReports": …}` for the snapshot: the recent reports (metadata only) and the lookup
 * result. A found report is shrunk step by step (fewer evidence ids, then shorter lists) to fit
 * {@link BRAIN_SECTION_LIMIT}; it is never cut mid-JSON.
 */
export function brainSection(
  recent: readonly BrainReportListRow[],
  lookup: BrainReportLookup,
): string {
  const list = recent.slice(0, RECENT_LIMIT).map((row) => ({
    id: row.id,
    scope: row.scope,
    projectId: row.projectId,
    createdAt: row.createdAt,
    deviations: row.deviations,
    high: row.high,
  }));
  const selectedId = lookup.status === 'available' ? lookup.report.id : null;
  const wrap = (report: unknown) =>
    safeJson({
      brainReports: {
        status: lookup.status,
        openOnPage: report ?? null,
        recent: list.map((row) => ({ ...row, openOnPage: row.id === selectedId })),
      },
    });
  if (lookup.status !== 'available') return wrap(null);
  for (const [perItem, listLimit] of [
    [EVIDENCE_PER_ITEM, LIST_LIMIT],
    [0, LIST_LIMIT],
    [0, 15],
    [0, 5],
  ] as const) {
    const section = wrap(reportView(lookup.report, perItem, listLimit));
    if (section.length <= BRAIN_SECTION_LIMIT) return section;
  }
  return wrap({ id: lookup.report.id, truncated: true });
}
