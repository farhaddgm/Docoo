/**
 * Independent critique of a solution (ADV-011, NXT-007). A critic that only plays the opponent does
 * not improve a decision: contrived dissent is weaker than authentic dissent (Nemeth and colleagues,
 * 2001). So a finding counts only when it is **grounded**: it quotes the solution's own assumptions,
 * evidence, plan, risks or criteria, and a quote the solution does not contain removes the finding.
 * There is no quota; a solution with nothing grounded to criticise gets an empty list.
 */
export const CRITIQUE_LENSES = ['premortem', 'assumption', 'outside_view', 'evidence'] as const;
export type CritiqueLens = (typeof CRITIQUE_LENSES)[number];

export const CRITIQUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type CritiqueSeverity = (typeof CRITIQUE_SEVERITIES)[number];

export const BASIS_KINDS = [
  'summary',
  'assumption',
  'evidence',
  'plan',
  'risk',
  'criterion',
] as const;
export type BasisKind = (typeof BASIS_KINDS)[number];

export interface CritiqueBasis {
  readonly kind: BasisKind;
  /** Words copied from the solution; checked against the solution itself. */
  readonly quote: string;
}

export interface CritiqueFinding {
  readonly lens: CritiqueLens;
  readonly title: string;
  /** What could go wrong, or what the solution takes for granted. */
  readonly claim: string;
  readonly basis: readonly CritiqueBasis[];
  /** A sign that would show it early. */
  readonly earlySign: string;
  /** What would lower the risk. */
  readonly control: string;
  readonly severity: CritiqueSeverity;
}

export interface CritiqueMaterial {
  readonly title: string;
  readonly summary: string;
  readonly assumptions: readonly string[];
  readonly evidence: readonly string[];
  readonly plan: readonly string[];
  readonly risks: readonly string[];
  readonly criteria: readonly string[];
}

/** Comparison form: one space between words, Persian letters unified, case folded. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‌‏‎]/gu, ' ')
    .replace(/ي/gu, 'ی')
    .replace(/ك/gu, 'ک')
    .replace(/[ً-ٰٟ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

const MIN_QUOTE = 6;

function sourceFor(material: CritiqueMaterial, kind: BasisKind): readonly string[] {
  switch (kind) {
    case 'summary':
      return [material.summary, material.title];
    case 'assumption':
      return material.assumptions;
    case 'evidence':
      return material.evidence;
    case 'plan':
      return material.plan;
    case 'risk':
      return material.risks;
    case 'criterion':
      return material.criteria;
  }
}

export function quoteIsGrounded(basis: CritiqueBasis, material: CritiqueMaterial): boolean {
  const quote = normalizeForQuote(basis.quote);
  if (quote.length < MIN_QUOTE) return false;
  return sourceFor(material, basis.kind).some((item) => normalizeForQuote(item).includes(quote));
}

const severityRank: Record<CritiqueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const lensRank = Object.fromEntries(CRITIQUE_LENSES.map((lens, i) => [lens, i])) as Record<
  CritiqueLens,
  number
>;

export interface GroundedCritique {
  readonly findings: CritiqueFinding[];
  /** How many findings were removed because none of their quotes could be found in the solution. */
  readonly dropped: number;
}

/**
 * Keeps the grounded part of a critique: a finding stays with the quotes that check out and goes
 * when none do. The rest is ordered by severity, then lens, so the worst comes first.
 */
export function groundCritique(
  findings: readonly CritiqueFinding[],
  material: CritiqueMaterial,
): GroundedCritique {
  const kept: CritiqueFinding[] = [];
  for (const finding of findings) {
    const basis = finding.basis.filter((b) => quoteIsGrounded(b, material));
    if (basis.length > 0) kept.push({ ...finding, basis });
  }
  kept.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      lensRank[a.lens] - lensRank[b.lens] ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
  return { findings: kept, dropped: findings.length - kept.length };
}

export type CritiqueAnswer = 'accept' | 'mitigate' | 'reject';

export interface CritiqueResponse {
  readonly title: string;
  readonly severity: CritiqueSeverity;
  readonly answer: CritiqueAnswer;
  readonly reason: string;
}

/** A finding at these severities may not be passed over without an answer and a reason. */
export const MUST_ANSWER: readonly CritiqueSeverity[] = ['high', 'critical'];

/** Findings that still need an answer before the choice is recorded. */
export function unanswered(
  findings: readonly Pick<CritiqueFinding, 'title' | 'severity'>[],
  answers: Readonly<Record<string, { answer: CritiqueAnswer | ''; reason: string } | undefined>>,
): string[] {
  return findings
    .filter((f) => MUST_ANSWER.includes(f.severity))
    .filter((f) => {
      const a = answers[f.title];
      return !a || a.answer === '' || (a.answer !== 'accept' && a.reason.trim().length < 3);
    })
    .map((f) => f.title);
}

/**
 * The answers as text for the decision journal, cut to fit the journal's reason. The answers are the
 * manager's own words; they are written down, never summarised by a model.
 */
export function formatCritiqueResponses(
  responses: readonly CritiqueResponse[],
  language: 'fa' | 'en',
  maxLength: number,
): string {
  if (responses.length === 0 || maxLength <= 0) return '';
  const names: Record<CritiqueAnswer, { fa: string; en: string }> = {
    accept: { fa: 'پذیرفته شد', en: 'accepted' },
    mitigate: { fa: 'کاهش می‌دهیم', en: 'will mitigate' },
    reject: { fa: 'رد شد', en: 'rejected' },
  };
  const head = language === 'fa' ? 'پاسخ به نقد:' : 'Answers to the critique:';
  const lines = responses.map((r) => {
    const reason = r.reason.trim();
    return `- ${r.title} (${r.severity}): ${names[r.answer][language]}${reason ? ` — ${reason}` : ''}`;
  });
  const text = `${head}\n${lines.join('\n')}`;
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
