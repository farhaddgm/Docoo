import { ROLE_EVALUATION_SCHEMA_NAME } from '@docoo/domain';
import type { NormalizedModelRequest } from '@docoo/providers';

import { fakeAnalystResponder } from './fake-analyst.js';

function dataOf(request: NormalizedModelRequest): Record<string, unknown> {
  const content = request.messages[0]?.content ?? '';
  const match = /<data>([\s\S]*)<\/data>/u.exec(content);
  try {
    return match ? (JSON.parse(match[1]!) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
      )
    : [];

const isPersian = (request: NormalizedModelRequest) =>
  (request.instructions ?? '').includes('Persian');

/**
 * Deterministic researcher: cites the first approved passage it was given with a verbatim
 * quote, adds one finding with no evidence (shown as unverified), and reports a gap. With no
 * approved knowledge it answers with the uncited finding only.
 */
export function fakeResearchResponder(request: NormalizedModelRequest): unknown {
  if (request.responseSchema?.name !== 'research_output') return null;
  const persian = isPersian(request);
  const passages = records(dataOf(request)['approvedKnowledge']);
  const first = passages[0];
  const findings: unknown[] = [];
  if (first && typeof first['ref'] === 'string' && typeof first['text'] === 'string') {
    const sentence = first['text'].split(/(?<=[.!؟?])\s/u)[0] ?? first['text'];
    findings.push({
      claim: persian
        ? `دانش تأییدشده «${String(first['title'])}» برای این مسئله مرتبط است.`
        : `The approved knowledge "${String(first['title'])}" is relevant to this problem.`,
      source: String(first['title']),
      evidence: [{ ref: first['ref'], quote: sentence.slice(0, 200) }],
    });
  }
  findings.push({
    claim: persian
      ? 'روش‌های مشابه در حوزه‌های دیگر هم به کار رفته‌اند.'
      : 'Similar approaches have been used in other fields.',
    source: persian ? 'دانش عمومی مدل' : 'General model knowledge',
    evidence: [],
  });
  return {
    findings,
    gaps: [
      persian
        ? 'هزینهٔ اجرای هر روش هنوز مشخص نیست.'
        : 'The running cost of each approach is not yet known.',
    ],
    conflicts: [],
  };
}

/**
 * Deterministic Brain judge: one strength and one deviation, each pointing at the first charter
 * principle/duty and the first sample it was shown. Without samples nothing is cited.
 */
export function fakeRoleEvaluationResponder(request: NormalizedModelRequest): unknown {
  if (request.responseSchema?.name !== ROLE_EVALUATION_SCHEMA_NAME) return null;
  const persian = isPersian(request);
  const data = dataOf(request);
  const charter = records(data['charter']);
  const samples = records(data['samples']);
  const principle = charter.find((item) => item['kind'] === 'principle')?.['ref'];
  const duty = charter.find((item) => item['kind'] === 'duty')?.['ref'];
  const sample = samples[0]?.['ref'];
  const findings =
    typeof principle === 'string' && typeof duty === 'string' && typeof sample === 'string'
      ? [
          {
            kind: 'strength',
            severity: 'low',
            detail: persian
              ? 'خروجی با اصل اول منشور هم‌خوان است.'
              : 'The output agrees with the first principle of the charter.',
            recommendation: '',
            clauseRefs: [principle],
            sampleRefs: [sample],
          },
          {
            kind: 'deviation',
            severity: 'medium',
            detail: persian
              ? 'وظیفهٔ اول فقط تا حدی در خروجی دیده می‌شود.'
              : 'The first duty is only partly visible in the output.',
            recommendation: persian
              ? 'دستور مرحله را برای پوشش کامل این وظیفه دقیق‌تر کنید.'
              : 'Make the stage prompt more explicit about this duty.',
            clauseRefs: [duty],
            sampleRefs: [sample],
          },
        ]
      : [];
  return {
    score: 4,
    summary: persian
      ? 'عملکرد نقش کلی با منشور هم‌خوان است و یک انحراف جزئی دارد.'
      : 'The role follows its charter overall with one minor deviation.',
    findings,
  };
}

/**
 * The scripted brain of the `fake` provider (never allowed in production): answers each
 * structured request by its schema name and leaves any other to the generic schema sampler.
 */
export function fakeResponder(request: NormalizedModelRequest): unknown {
  return (
    fakeAnalystResponder(request) ??
    fakeResearchResponder(request) ??
    fakeRoleEvaluationResponder(request)
  );
}
