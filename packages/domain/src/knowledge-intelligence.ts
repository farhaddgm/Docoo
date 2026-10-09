/** Versioned, offline semantic projection. Unknown concepts retain lexical features. */
export const knowledgeIntelligenceVersion = 'knowledge-intelligence-v1' as const;
export const localEmbeddingModel = 'docoo-business-concepts-v1' as const;

const concepts: readonly (readonly string[])[] = [
  ['churn', 'attrition', 'ریزش', 'ترک مشتری'],
  ['customer', 'customers', 'client', 'clients', 'مشتری', 'مشتریان'],
  ['retention', 'وفاداری', 'نگهداشت', 'حفظ مشتری'],
  ['cost', 'costs', 'expense', 'expenses', 'هزینه', 'مخارج'],
  ['revenue', 'revenues', 'income', 'درآمد', 'درامد'],
  ['profit', 'profits', 'profitability', 'سود', 'سودآوری', 'سوداوری'],
  ['growth', 'growing', 'رشد'],
  ['market', 'markets', 'بازار'],
  ['sales', 'sale', 'selling', 'فروش'],
  ['marketing', 'advertising', 'تبلیغات', 'بازاریابی'],
  ['budget', 'budgets', 'بودجه'],
  ['time', 'duration', 'زمان', 'مدت'],
  ['risk', 'risks', 'ریسک', 'خطر'],
  ['supply chain', 'زنجیره تامین', 'زنجیره تأمین'],
  ['inventory', 'stock', 'موجودی', 'انبار'],
  ['operation', 'operations', 'operational', 'عملیات', 'عملیاتی'],
  ['product', 'products', 'محصول', 'محصولات'],
  ['quality', 'کیفیت'],
  ['efficiency', 'productivity', 'بهره وری', 'کارایی'],
  ['employee', 'employees', 'staff', 'workforce', 'کارکنان', 'نیروی انسانی'],
  ['satisfaction', 'رضایت'],
  ['conversion', 'تبدیل'],
  ['pricing', 'price', 'prices', 'قیمت', 'قیمت گذاری'],
  ['delivery', 'shipping', 'تحویل', 'ارسال'],
  ['delay', 'delays', 'تاخیر', 'تأخیر'],
  ['automation', 'automated', 'خودکارسازی', 'اتوماسیون'],
  ['competition', 'competitor', 'competitors', 'رقابت', 'رقیب', 'رقبا'],
  ['expansion', 'expand', 'development', 'توسعه', 'گسترش'],
  ['investment', 'investing', 'سرمایه گذاری'],
  ['return on investment', 'roi', 'بازده سرمایه'],
  ['cash flow', 'نقدینگی', 'جریان نقد'],
  ['training', 'education', 'آموزش', 'اموزش'],
  ['support', 'پشتیبانی'],
  ['onboarding', 'راه اندازی', 'آشنایی اولیه'],
  ['security', 'امنیت'],
  ['privacy', 'حریم خصوصی', 'محرمانگی'],
  ['data', 'dataset', 'داده', 'اطلاعات'],
  ['measurement', 'metric', 'metrics', 'indicator', 'kpi', 'شاخص', 'اندازه گیری'],
  ['experiment', 'experimental', 'trial', 'آزمایش', 'ازمایش', 'کارآزمایی'],
  ['survey', 'observational', 'نظرسنجی', 'مشاهده ای'],
  ['small business', 'sme', 'کسب وکار کوچک', 'شرکت کوچک'],
  ['enterprise', 'large company', 'شرکت بزرگ', 'بنگاه بزرگ'],
];

const stopWords = new Set(
  'the a an of to in for and or is are was were with by on at how does do what which can this that be as it from our your در به از و یا با برای است هستند این آن که آیا چه چگونه یک را می شود'.split(
    ' ',
  ),
);

export function normalizeKnowledgeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/gu, 'ی')
    .replace(/ك/gu, 'ک')
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, '')
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٪/gu, '%')
    .replace(/[\u200c\u200d]/gu, ' ')
    .replace(/\.(?!\d)|(?<!\d)\./gu, ' ')
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function knowledgeTokens(text: string): string[] {
  return normalizeKnowledgeText(text)
    .split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

export function knowledgeConcepts(text: string): number[] {
  const normalized = ` ${normalizeKnowledgeText(text)} `;
  return concepts.flatMap((aliases, index) =>
    aliases.some((alias) => normalized.includes(` ${normalizeKnowledgeText(alias)} `))
      ? [index]
      : [],
  );
}

export function expandKnowledgeQuery(text: string): string[] {
  return [
    ...new Set([
      ...knowledgeTokens(text),
      ...knowledgeConcepts(text).flatMap((index) => concepts[index]!.flatMap(knowledgeTokens)),
    ]),
  ].slice(0, 100);
}

export function localKnowledgeEmbedding(text: string): number[] {
  const vector = Array<number>(384).fill(0);
  for (const concept of knowledgeConcepts(text)) vector[concept] = 4;
  for (const token of new Set(knowledgeTokens(text))) {
    let hash = 2166136261;
    for (const character of token) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
    const slot = concepts.length + ((hash >>> 0) % (384 - concepts.length));
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (
    a.length === 0 ||
    a.length !== b.length ||
    a.some((n) => !Number.isFinite(n)) ||
    b.some((n) => !Number.isFinite(n))
  )
    throw new Error('EMBEDDING_INVALID');
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  return denominator === 0
    ? 0
    : Math.max(
        -1,
        Math.min(1, a.reduce((sum, value, index) => sum + value * b[index]!, 0) / denominator),
      );
}

export interface IntelligenceClaim {
  readonly id: string;
  readonly text: string;
  readonly language: 'fa' | 'en';
  readonly knowledgeVersionId: string;
  readonly sourceVersionId: string;
  readonly title: string;
  readonly quote: string;
  readonly quoteHash: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly auditScore: number;
  readonly evidenceAdequacy: number;
  readonly freshness: number;
  readonly publishedAt: string | null;
  readonly finalUrl: string | null;
  readonly confidentiality: 'public' | 'internal' | 'restricted';
}

export interface RankedIntelligenceClaim {
  readonly claim: IntelligenceClaim;
  readonly score: number;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly matchedTerms: readonly string[];
  readonly matchedConcepts: readonly number[];
}

/** BM25 + vector rank fusion, followed by explainable coverage reranking. */
export function rankKnowledgeClaims(input: {
  readonly query: string;
  readonly claims: readonly IntelligenceClaim[];
  readonly mode?: 'lexical' | 'hybrid';
  readonly limit: number;
  readonly vectors?: {
    readonly query: readonly number[];
    readonly claims: ReadonlyMap<string, readonly number[]>;
  };
  readonly fullTextScores?: ReadonlyMap<string, number>;
}): RankedIntelligenceClaim[] {
  const queryTokens = [...new Set(knowledgeTokens(input.query))];
  const queryConcepts = knowledgeConcepts(input.query);
  const documents = input.claims.map((claim) => ({ claim, tokens: knowledgeTokens(claim.text) }));
  const averageLength =
    documents.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, documents.length);
  const frequency = new Map(
    queryTokens.map((token) => [
      token,
      documents.filter((doc) => doc.tokens.includes(token)).length,
    ]),
  );
  const queryVector = input.vectors?.query ?? localKnowledgeEmbedding(input.query);
  const scored = documents.map(({ claim, tokens }) => {
    const matchedTerms = queryTokens.filter((token) => tokens.includes(token));
    const claimConcepts = knowledgeConcepts(claim.text);
    const matchedConcepts = queryConcepts.filter((concept) => claimConcepts.includes(concept));
    const lexicalScore =
      input.fullTextScores?.get(claim.id) ??
      queryTokens.reduce((sum, token) => {
        const count = tokens.filter((word) => word === token).length;
        const df = frequency.get(token) ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        return (
          sum +
          (idf * (count * 2.2)) /
            (count + 1.2 * (0.25 + (0.75 * tokens.length) / Math.max(1, averageLength)))
        );
      }, 0);
    const semanticScore = cosineSimilarity(
      queryVector,
      input.vectors?.claims.get(claim.id) ?? localKnowledgeEmbedding(claim.text),
    );
    return { claim, score: 0, lexicalScore, semanticScore, matchedTerms, matchedConcepts };
  });
  const lexical = scored
    .filter((row) => row.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore || a.claim.id.localeCompare(b.claim.id));
  if (input.mode === 'lexical')
    return lexical.slice(0, input.limit).map((row) => ({ ...row, score: row.lexicalScore }));
  // Feature hashing alone is not evidence of a match: require a term/concept, or a learned vector.
  const semantic = scored
    .filter(
      (row) =>
        row.semanticScore >= 0.18 &&
        (input.vectors || row.matchedConcepts.length > 0 || row.matchedTerms.length > 0),
    )
    .sort((a, b) => b.semanticScore - a.semanticScore || a.claim.id.localeCompare(b.claim.id));
  const lexRanks = new Map(lexical.map((row, index) => [row.claim.id, index + 1]));
  const semRanks = new Map(semantic.map((row, index) => [row.claim.id, index + 1]));
  return scored
    .filter((row) => lexRanks.has(row.claim.id) || semRanks.has(row.claim.id))
    .map((row) => {
      const lexRank = lexRanks.get(row.claim.id);
      const semRank = semRanks.get(row.claim.id);
      const fusion = (lexRank ? 1 / (60 + lexRank) : 0) + (semRank ? 1 / (60 + semRank) : 0);
      const coverage = Math.max(
        row.matchedTerms.length / Math.max(1, queryTokens.length),
        row.matchedConcepts.length / Math.max(1, queryConcepts.length),
      );
      return {
        ...row,
        score: Number(
          (fusion * 15 + coverage * 0.3 + Math.max(0, row.semanticScore) * 0.2).toFixed(6),
        ),
      };
    })
    .sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id))
    .slice(0, input.limit);
}

export interface ConflictSuggestion {
  readonly claimAId: string;
  readonly claimBId: string;
  readonly kind: 'contradiction' | 'temporal' | 'scope' | 'methodology';
  readonly reasonCode: 'opposite_direction' | 'negated_assertion' | 'different_estimate';
  readonly differences: readonly ('date' | 'population' | 'method' | 'quantity')[];
  readonly reviewRequired: true;
}

function direction(text: string): -1 | 0 | 1 {
  const normalized = ` ${normalizeKnowledgeText(text)} `;
  const up = / (increase[ds]?|rose|rise|rises|higher|improve[ds]?|افزایش|بیشتر|بهبود) /u.test(
    normalized,
  );
  const down = / (decrease[ds]?|reduce[ds]?|fell|fall|lower|کاهش|کمتر) /u.test(normalized);
  return up === down ? 0 : up ? 1 : -1;
}

function negated(text: string): boolean {
  return / (not|no|never|نمی|نیست|ندارد|نشد|نکرد) /u.test(` ${normalizeKnowledgeText(text)} `);
}

/** Conservative candidates only. Two estimates are not automatically a contradiction. */
export function detectKnowledgeConflicts(
  claims: readonly IntelligenceClaim[],
  limit = 50,
): ConflictSuggestion[] {
  const output: ConflictSuggestion[] = [];
  const ordered = [...claims].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < ordered.length && output.length < limit; i++) {
    const a = ordered[i]!;
    const aConcepts = knowledgeConcepts(a.text).filter((id) => id < 38);
    const aTokens = new Set(knowledgeTokens(a.text));
    for (let j = i + 1; j < ordered.length && output.length < limit; j++) {
      const b = ordered[j]!;
      if (
        a.sourceVersionId === b.sourceVersionId ||
        normalizeKnowledgeText(a.text) === normalizeKnowledgeText(b.text)
      )
        continue;
      const commonConcepts = knowledgeConcepts(b.text).filter((id) => aConcepts.includes(id));
      const commonTerms = knowledgeTokens(b.text).filter((term) => aTokens.has(term));
      if (commonConcepts.length < 2 && commonTerms.length < 3) continue;
      const opposite = direction(a.text) !== 0 && direction(b.text) === -direction(a.text);
      const negation = negated(a.text) !== negated(b.text);
      const aNumbers = normalizeKnowledgeText(a.text).match(/\d+(?:\.\d+)?\s*%/gu) ?? [];
      const bNumbers = normalizeKnowledgeText(b.text).match(/\d+(?:\.\d+)?\s*%/gu) ?? [];
      const quantity =
        aNumbers.length === 1 && bNumbers.length === 1 && aNumbers[0] !== bNumbers[0];
      if (!opposite && !negation && !quantity) continue;
      const differences: ('date' | 'population' | 'method' | 'quantity')[] = [];
      if (a.publishedAt && b.publishedAt && a.publishedAt !== b.publishedAt)
        differences.push('date');
      const population = (text: string) =>
        knowledgeConcepts(text)
          .filter((id) => id >= 40)
          .join(',');
      if (population(a.text) !== population(b.text)) differences.push('population');
      const method = (text: string) =>
        knowledgeConcepts(text)
          .filter((id) => id === 38 || id === 39)
          .join(',');
      if (method(a.text) !== method(b.text)) differences.push('method');
      if (quantity) differences.push('quantity');
      output.push({
        claimAId: a.id,
        claimBId: b.id,
        kind: differences.includes('population')
          ? 'scope'
          : differences.includes('method') || (!opposite && !negation)
            ? 'methodology'
            : differences.includes('date')
              ? 'temporal'
              : 'contradiction',
        reasonCode: opposite
          ? 'opposite_direction'
          : negation
            ? 'negated_assertion'
            : 'different_estimate',
        differences,
        reviewRequired: true,
      });
    }
  }
  return output;
}

export interface EvidenceAssessment {
  readonly status: 'insufficient' | 'conflicted' | 'supported_with_limits';
  readonly coverage: number;
  readonly supportingClaimIds: readonly string[];
  readonly opposingClaimIds: readonly string[];
  readonly sourceCount: number;
  readonly independence: 'unknown';
  readonly freshness: 'unknown' | 'reviewed';
  readonly applicability: 'unknown' | 'reviewed';
  readonly reasons: readonly string[];
  readonly probabilityOfTruth: null;
}

export function assessEvidence(input: {
  readonly assertion: string;
  readonly supports: readonly IntelligenceClaim[];
  readonly opposes?: readonly IntelligenceClaim[];
  readonly applicabilityReviewed?: boolean;
}): EvidenceAssessment {
  const ranked = rankKnowledgeClaims({
    query: input.assertion,
    claims: input.supports,
    limit: 100,
  });
  const relevant = ranked.filter(
    (row) => row.matchedConcepts.length >= 1 || row.matchedTerms.length >= 2,
  );
  const assertionNumbers =
    normalizeKnowledgeText(input.assertion).match(/\d+(?:\.\d+)?\s*%?/gu) ?? [];
  const supported = relevant.filter(({ claim }) => {
    const quoteNumbers = normalizeKnowledgeText(claim.quote).match(/\d+(?:\.\d+)?\s*%?/gu) ?? [];
    return (
      claim.evidenceAdequacy >= 60 &&
      assertionNumbers.every((number) =>
        quoteNumbers.some((value) => value.trim() === number.trim()),
      )
    );
  });
  const opposing = input.opposes ?? [];
  const reasons: string[] = [];
  if (supported.length === 0)
    reasons.push(
      assertionNumbers.length > 0 ? 'quantified_assertion_not_supported' : 'no_adequate_support',
    );
  if (opposing.length > 0) reasons.push('opposing_evidence');
  if (!input.applicabilityReviewed) reasons.push('applicability_not_reviewed');
  reasons.push('source_independence_unknown');
  const freshness =
    supported.length > 0 &&
    supported.every(({ claim }) => claim.freshness >= 60 && claim.publishedAt !== null)
      ? ('reviewed' as const)
      : ('unknown' as const);
  if (freshness === 'unknown') reasons.push('freshness_unknown');
  return {
    status:
      opposing.length > 0
        ? 'conflicted'
        : supported.length === 0 || !input.applicabilityReviewed
          ? 'insufficient'
          : 'supported_with_limits',
    coverage:
      supported.length === 0
        ? 0
        : Math.round(
            100 *
              Math.max(
                ...supported.map((row) =>
                  Math.max(
                    row.matchedTerms.length / Math.max(1, knowledgeTokens(input.assertion).length),
                    row.matchedConcepts.length /
                      Math.max(1, knowledgeConcepts(input.assertion).length),
                  ),
                ),
              ),
          ),
    supportingClaimIds: supported.map(({ claim }) => claim.id),
    opposingClaimIds: opposing.map((claim) => claim.id),
    sourceCount: new Set(supported.map(({ claim }) => claim.sourceVersionId)).size,
    independence: 'unknown',
    freshness,
    applicability: input.applicabilityReviewed ? 'reviewed' : 'unknown',
    reasons,
    probabilityOfTruth: null,
  };
}

export interface AdaptiveResearchPlan {
  readonly questions: readonly {
    readonly id: string;
    readonly text: string;
    readonly importance: number;
  }[];
  readonly maxRounds: number;
  readonly maxClaimVisits: number;
  readonly targetCoverage: number;
  readonly perQuestionLimit: number;
}

export function runAdaptiveResearch(
  plan: AdaptiveResearchPlan,
  claims: readonly IntelligenceClaim[],
) {
  const seen = new Set<string>();
  const searched = new Set<string>();
  const rounds: {
    round: number;
    questionId: string;
    query: string;
    newClaimIds: string[];
    visits: number;
  }[] = [];
  const coverage = plan.questions.map((question) => ({
    ...question,
    claimIds: [] as string[],
    covered: false,
  }));
  let visits = 0;
  let stopReason: 'coverage_reached' | 'round_limit' | 'visit_budget' | 'no_new_evidence' =
    'round_limit';
  const coveredPercent = () =>
    Math.round(
      (100 *
        coverage
          .filter((question) => question.covered)
          .reduce((sum, question) => sum + question.importance, 0)) /
        Math.max(
          1,
          coverage.reduce((sum, question) => sum + question.importance, 0),
        ),
    );
  for (let round = 1; round <= plan.maxRounds; round++) {
    if (coveredPercent() >= plan.targetCoverage) {
      stopReason = 'coverage_reached';
      break;
    }
    if (visits >= plan.maxClaimVisits) {
      stopReason = 'visit_budget';
      break;
    }
    const question = [...coverage]
      .filter((row) => !row.covered && !searched.has(row.id))
      .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))[0];
    if (!question) {
      stopReason = 'no_new_evidence';
      break;
    }
    searched.add(question.id);
    const ranked = rankKnowledgeClaims({
      query: question.text,
      claims,
      limit: Math.min(plan.perQuestionLimit, plan.maxClaimVisits - visits),
    });
    visits += ranked.length;
    const supportedIds = new Set(
      assessEvidence({ assertion: question.text, supports: ranked.map((row) => row.claim) })
        .supportingClaimIds,
    );
    const usable = ranked.filter(({ claim }) => supportedIds.has(claim.id));
    question.claimIds = usable.map(({ claim }) => claim.id);
    question.covered = usable.length > 0;
    const newClaimIds = usable.map(({ claim }) => claim.id).filter((id) => !seen.has(id));
    for (const id of newClaimIds) seen.add(id);
    rounds.push({ round, questionId: question.id, query: question.text, newClaimIds, visits });
    // Each question is searched once; a missing answer must not starve other questions.
    if (coverage.every((row) => row.covered || searched.has(row.id))) {
      stopReason = 'no_new_evidence';
      break;
    }
  }
  const finalCoverage = Math.round(
    (100 * coverage.filter((q) => q.covered).reduce((sum, q) => sum + Math.abs(q.importance), 0)) /
      Math.max(
        1,
        coverage.reduce((sum, q) => sum + Math.abs(q.importance), 0),
      ),
  );
  if (finalCoverage >= plan.targetCoverage) stopReason = 'coverage_reached';
  else if (visits >= plan.maxClaimVisits) stopReason = 'visit_budget';
  return {
    version: knowledgeIntelligenceVersion,
    rounds,
    coverage: finalCoverage,
    stopReason,
    claimVisits: visits,
    status:
      finalCoverage >= plan.targetCoverage
        ? ('coverage_reached' as const)
        : ('insufficient_evidence' as const),
    questions: coverage.map((q) => ({ ...q, importance: Math.abs(q.importance) })),
    selectedClaimIds: [...seen],
    nextQueries: coverage
      .filter((q) => !q.covered)
      .map((q) => ({ questionId: q.id, query: q.text, reason: 'coverage_gap' as const })),
    externalCost: 0,
    researchScope: 'approved_internal' as const,
  };
}
