import { OUTLINE_SCHEMA_NAME, SECTION_SCHEMA_NAME } from '@docoo/documents';
import { ROLE_EVALUATION_SCHEMA_NAME } from '@docoo/domain';
import type { NormalizedModelRequest, ToolCall } from '@docoo/providers';

import { dataOf, fakeAnalystResponder } from './fake-analyst.js';

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

const lettersOf = (value: string): number => (value.match(/[\p{L}\p{N}]/gu) ?? []).length;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One draft block of the document-section schema with every field present. */
const draftBlock = (kind: string, patch: Record<string, unknown> = {}) => ({
  kind,
  text: '',
  ordered: false,
  items: [],
  caption: '',
  columns: [],
  rows: [],
  tone: 'info',
  citations: [],
  ...patch,
});

/**
 * Deterministic documenter. The outline gives each section the number of subsections it was
 * asked for; a section answer is built from the solution's own words and numbered filler
 * sentences until the budget's target is reached, so every level can be exercised without a
 * provider. The first paragraph cites the first approved passage verbatim, tables only appear
 * when the instructions allow them, and an expand or condense call returns the whole subsection
 * again at the length it was asked for.
 */
export function fakeDocumenterResponder(request: NormalizedModelRequest): unknown {
  const name = request.responseSchema?.name;
  if (name !== OUTLINE_SCHEMA_NAME && name !== SECTION_SCHEMA_NAME) return null;
  const persian = isPersian(request);
  const data = dataOf(request);
  if (name === OUTLINE_SCHEMA_NAME) {
    return {
      sections: records(data['sections']).map((section) => ({
        key: asString(section['key']),
        subsections: Array.from(
          { length: Number(section['subsectionCount']) || 1 },
          (_, index) => ({
            heading: persian
              ? `${asString(section['label'])}؛ بخش ${index + 1}`
              : `${asString(section['label'])}: part ${index + 1}`,
            focus: persian
              ? `جنبهٔ ${index + 1} از «${asString(section['label'])}» بدون تکرار بخش‌های دیگر.`
              : `Aspect ${index + 1} of "${asString(section['label'])}", not repeating the other parts.`,
          }),
        ),
      })),
    };
  }

  const part = (data['part'] ?? {}) as Record<string, unknown>;
  const budget = (data['budget'] ?? {}) as Record<string, unknown>;
  const solution = (data['solution'] ?? {}) as Record<string, unknown>;
  const target = Math.max(60, Number(budget['targetLetters']) || 400);
  const title = asString(solution['title']);
  const heading = asString(part['heading']) || asString(part['section']);
  const covers = asString(part['covers']);
  const items = (key: string): string[] =>
    Array.isArray(solution[key]) ? (solution[key] as unknown[]).map(asString).filter(Boolean) : [];
  const own = [
    asString(solution['summary']),
    ...items('assumptions'),
    ...items('evidence'),
    ...items('plan'),
    ...items('risks'),
  ].filter(Boolean);

  const fa = [
    (i: number) =>
      `در بخش «${heading}»، نکتهٔ ${i} دربارهٔ «${title}» این است که اجرای آن باید با شرایط مسئله هم‌خوان بماند.`,
    (i: number) =>
      `برای مورد ${i}، پیش‌نیازها و دامنهٔ کار روشن می‌شود تا تصمیم‌گیری دربارهٔ «${title}» ساده‌تر شود.`,
    (i: number) => `گام ${i} تأثیر مستقیم بر نتیجه دارد و باید پیش از شروع مرحلهٔ بعد بررسی شود.`,
    (i: number) =>
      `در بند ${i} هزینه، زمان و منابع لازم با هم سنجیده می‌شوند و هیچ‌کدام جداگانه تصمیم‌ساز نیست.`,
  ];
  const en = [
    (i: number) =>
      `In "${heading}", point ${i} about ${title} is that its delivery has to stay consistent with the situation of the problem.`,
    (i: number) =>
      `For item ${i}, the prerequisites and the scope of the work are made clear so that deciding on ${title} becomes simpler.`,
    (i: number) =>
      `Step ${i} has a direct effect on the result and has to be reviewed before the next phase starts.`,
    (i: number) =>
      `In clause ${i}, cost, time and resources are weighed together and none of them decides alone.`,
  ];
  const templates = persian ? fa : en;
  const sentence = (index: number): string =>
    index % 3 === 0 && own.length > 0
      ? own[(index / 3) % own.length]!
      : templates[index % templates.length]!(index + 1);

  const call = asString(data['call']);
  const goal = target;
  const paragraphs: string[] = [];
  let letters = 0;
  let index = 0;
  let current: string[] = [];
  while (letters < goal && index < 4000) {
    const next = sentence(index);
    const size = lettersOf(next);
    if (letters > 0 && letters + size / 2 > goal) break;
    current.push(next);
    letters += size;
    index += 1;
    if (current.length === 3) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '));

  const knowledge = records(data['approvedKnowledge']);
  const first = knowledge[0];
  const quote =
    first && typeof first['text'] === 'string'
      ? (first['text'].split(/(?<=[.!؟?])\s/u)[0] ?? first['text']).slice(0, 200)
      : '';
  const tablesAllowed = !(request.instructions ?? '').includes('Tables and charts are not allowed');
  const blocks = paragraphs.map((text, position) =>
    draftBlock('paragraph', {
      text,
      citations:
        position === 0 && first && typeof first['ref'] === 'string' && quote
          ? [{ ref: first['ref'], quote }]
          : [],
    }),
  );
  if (call === 'section' && covers === 'plan' && tablesAllowed && target > 600) {
    blocks.push(
      draftBlock('table', {
        caption: persian ? 'مراحل اجرا' : 'Delivery steps',
        columns: persian ? ['گام', 'شرح'] : ['Step', 'Description'],
        rows: items('plan').map((step, position) => [String(position + 1), step]),
      }),
    );
  }
  if (call === 'section' && covers === 'risks' && target > 600) {
    blocks.push(
      draftBlock('callout', {
        tone: 'warning',
        text: persian
          ? 'ریسک‌های اصلی باید پیش از شروع پذیرفته یا کنترل شوند.'
          : 'The main risks have to be accepted or controlled before work starts.',
      }),
    );
  }
  return { blocks };
}

/**
 * The scripted brain of the `fake` provider (never allowed in production): answers each
 * structured request by its schema name and leaves any other to the generic schema sampler.
 */
export function fakeResponder(request: NormalizedModelRequest): unknown {
  return (
    fakeAnalystResponder(request) ??
    fakeResearchResponder(request) ??
    fakeRoleEvaluationResponder(request) ??
    fakeDocumenterResponder(request)
  );
}

/**
 * Deterministic tool use for the offline provider: it answers the model self-check's question
 * (17 times 23) by asking for the calculator, and the model `fake-asks-human` makes the ideator ask
 * the administrator once; otherwise a pipeline run with tool calling on never calls a tool by
 * itself. Tests script their own calls.
 */
export function fakeToolResponder(request: NormalizedModelRequest): readonly ToolCall[] | null {
  const first = request.messages[0];
  // The model named `fake-asks-human` makes the ideator ask the administrator once, so the
  // question screen can be tried and tested without a real model.
  if (
    request.model === 'fake-asks-human' &&
    (request.instructions ?? '').includes('Your role: ideator.') &&
    (request.tools?.some((tool) => tool.name === 'request_human_input') ?? false) &&
    first?.role === 'user' &&
    request.messages.length === 1 &&
    !first.content.includes('"humanAnswers"')
  ) {
    return [
      {
        id: 'call_ask',
        name: 'request_human_input',
        arguments: { question: 'What is the budget ceiling?', reason: 'To rank the solutions' },
      },
    ];
  }
  const asked = first && first.role === 'user' && first.content.includes('17 times 23');
  const answered = request.messages.some((message) => message.role === 'tool');
  const offered = request.tools?.some((tool) => tool.name === 'calculator') ?? false;
  return asked && offered && !answered
    ? [{ id: 'call_selfcheck', name: 'calculator', arguments: { expression: '17 * 23' } }]
    : null;
}
