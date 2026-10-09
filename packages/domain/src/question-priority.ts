import { knowledgeConcepts, knowledgeTokens } from './knowledge-intelligence.js';

const areaWeights: Readonly<Record<string, number>> = {
  constraints: 100,
  success_criteria: 95,
  budget: 90,
  goals: 85,
  risks: 80,
  data: 75,
  underlying_need: 70,
  timeline: 65,
  stakeholders: 50,
  context: 45,
};

export function prioritizeAnalysisQuestions<
  T extends {
    readonly id: string;
    readonly coverageArea: string;
    readonly text: string;
    readonly ordinal: number;
    readonly answer: { readonly status: string | null; readonly text: string | null } | null;
  },
>(
  questions: readonly T[],
  criteria: readonly string[] = [],
  references: readonly { id: string; text: string; kind: 'criterion' | 'assumption' }[] = [],
) {
  const answered = questions.filter((q) => q.answer?.status === 'answered');
  const coveredAreas = new Set(answered.map((q) => q.coverageArea));
  const criterionConcepts = new Set(criteria.flatMap(knowledgeConcepts));
  const criterionTerms = new Set(criteria.flatMap(knowledgeTokens));
  return questions
    .map((question) => {
      const unresolved =
        !question.answer ||
        question.answer.status === 'unanswered' ||
        question.answer.status === 'later';
      const criterionMatch =
        knowledgeConcepts(question.text).some((id) => criterionConcepts.has(id)) ||
        knowledgeTokens(question.text).some((word) => criterionTerms.has(word));
      const linkedReferences = references.filter(
        (reference) =>
          knowledgeConcepts(reference.text).some((id) =>
            knowledgeConcepts(question.text).includes(id),
          ) ||
          knowledgeTokens(reference.text).some((term) =>
            knowledgeTokens(question.text).includes(term),
          ),
      );
      const assumptionMatch = linkedReferences.some((reference) => reference.kind === 'assumption');
      const duplicateAnswer = answered.some(
        (q) =>
          q.id !== question.id &&
          knowledgeTokens(q.text).join(' ') === knowledgeTokens(question.text).join(' '),
      );
      const reasons = [
        coveredAreas.has(question.coverageArea) ? 'area_already_covered' : 'unresolved_area',
        ...(criterionMatch ? ['decision_criterion'] : []),
        ...(assumptionMatch ? ['decision_assumption'] : []),
        ...(duplicateAnswer ? ['duplicate_answered_question'] : []),
        ...(question.answer?.status === 'later' ? ['follow_up'] : []),
      ];
      const score = Math.max(
        0,
        Math.min(
          100,
          (areaWeights[question.coverageArea] ?? 40) * 0.6 +
            (coveredAreas.has(question.coverageArea) ? 0 : 25) +
            (criterionMatch ? 15 : 0) -
            (duplicateAnswer ? 50 : 0) +
            (assumptionMatch ? 10 : 0),
        ),
      );
      return {
        ...question,
        priority: {
          score: unresolved ? score : 0,
          reasons,
          method: 'information-value-heuristic-v1' as const,
          criterionMatched: criterionMatch,
          references: linkedReferences,
        },
      };
    })
    .sort(
      (a, b) =>
        b.priority.score - a.priority.score || a.ordinal - b.ordinal || a.id.localeCompare(b.id),
    );
}
