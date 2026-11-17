'use client';

import { useState } from 'react';
import {
  MUST_ANSWER,
  type CritiqueAnswer,
  type CritiqueFinding,
  type CritiqueLens,
  type CritiqueSeverity,
} from '@docoo/contracts';
import { apiSend } from '../../../api-client';
import { formatNumber, type Locale, textDir } from '../../../i18n';

export interface CritiqueView {
  solutionId: string;
  setId: string | null;
  findings: CritiqueFinding[];
  dropped: number;
  independentModel: boolean;
}

export type AnswerMap = Record<
  string,
  Record<string, { answer: CritiqueAnswer | ''; reason: string }>
>;

const words = {
  fa: {
    title: 'نقد مستقل',
    intro:
      'یک نقاد جدا فقط ضعف‌هایی را می‌آورد که از خودِ متن راه‌حل قابل‌نقل باشد؛ هر نکته‌ای که به متن راه‌حل ارجاع نداشته باشد حذف می‌شود. نقد امتیاز را عوض نمی‌کند و انتخاب با شماست.',
    run: 'نقد این راه‌حل',
    running: 'در حال نقد…',
    again: 'نقد دوباره',
    failed: 'نقد انجام نشد. دوباره تلاش کنید.',
    none: 'نقد معتبری که به متن راه‌حل ارجاع بدهد پیدا نشد.',
    dropped: (n: string) => `${n} نکته چون به متن راه‌حل ارجاع نداشت حذف شد.`,
    sameModel: 'نقاد از همان مدل پروژه استفاده می‌کند؛ مستقل‌بودن کامل نیست.',
    lenses: {
      premortem: 'پیش‌مرگ',
      assumption: 'فرض‌ها',
      outside_view: 'نگاه بیرونی',
      evidence: 'شواهد',
    } as Record<CritiqueLens, string>,
    severities: { critical: 'بحرانی', high: 'زیاد', medium: 'متوسط', low: 'کم' } as Record<
      CritiqueSeverity,
      string
    >,
    kinds: {
      summary: 'خلاصه',
      assumption: 'فرض',
      evidence: 'شاهد',
      plan: 'برنامه',
      risk: 'ریسک',
      criterion: 'معیار',
    } as Record<string, string>,
    earlySign: 'نشانهٔ زودهنگام',
    control: 'کنترل پیشنهادی',
    answer: 'پاسخ شما',
    answers: {
      '': 'انتخاب کنید',
      accept: 'می‌پذیرم',
      mitigate: 'کاهش می‌دهم',
      reject: 'رد می‌کنم',
    } as Record<string, string>,
    reason: 'دلیل',
    required: 'برای نکته‌های زیاد و بحرانی پاسخ لازم است.',
  },
  en: {
    title: 'Independent critique',
    intro:
      'A separate critic lists only weaknesses it can quote from the solution’s own text; any point that does not point into the solution is dropped. The critique never changes a score and the choice stays yours.',
    run: 'Critique this solution',
    running: 'Critiquing…',
    again: 'Critique again',
    failed: 'The critique did not run. Try again.',
    none: 'No valid critique could be tied to the solution’s text.',
    dropped: (n: string) =>
      `${n} point(s) were dropped because they did not point into the solution.`,
    sameModel: 'The critic uses the project’s own model, so it is not fully independent.',
    lenses: {
      premortem: 'Pre-mortem',
      assumption: 'Assumptions',
      outside_view: 'Outside view',
      evidence: 'Evidence',
    } as Record<CritiqueLens, string>,
    severities: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as Record<
      CritiqueSeverity,
      string
    >,
    kinds: {
      summary: 'Summary',
      assumption: 'Assumption',
      evidence: 'Evidence',
      plan: 'Plan',
      risk: 'Risk',
      criterion: 'Criterion',
    } as Record<string, string>,
    earlySign: 'Early sign',
    control: 'Suggested control',
    answer: 'Your answer',
    answers: {
      '': 'Choose',
      accept: 'I accept it',
      mitigate: 'I will mitigate it',
      reject: 'I reject it',
    } as Record<string, string>,
    reason: 'Reason',
    required: 'High and critical points need an answer.',
  },
};

const severityBadge: Record<CritiqueSeverity, string> = {
  critical: 'state-failed',
  high: 'state-failed',
  medium: 'state-paused',
  low: 'state-pending',
};

export function CritiquePanel({
  locale,
  base,
  solutions,
  results,
  answers,
  readOnly,
  onResult,
  onAnswer,
}: {
  locale: Locale;
  base: string;
  solutions: { id: string; title: string }[];
  results: Record<string, CritiqueView>;
  answers: AnswerMap;
  readOnly: boolean;
  onResult: (view: CritiqueView) => void;
  onAnswer: (
    solutionId: string,
    title: string,
    value: { answer: CritiqueAnswer | ''; reason: string },
  ) => void;
}) {
  const t = words[locale];
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function run(solutionId: string) {
    setBusy(solutionId);
    setFailed(null);
    try {
      const { critique } = await apiSend<{ critique: CritiqueView }>(
        'POST',
        `${base}/solutions/${solutionId}/critique`,
      );
      onResult(critique);
    } catch {
      setFailed(solutionId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack" aria-labelledby="critique-title">
      <h2 id="critique-title">{t.title}</h2>
      <p className="muted">{t.intro}</p>
      {solutions.map((solution) => {
        const view = results[solution.id];
        return (
          <div key={solution.id} className="card stack">
            <h3 dir={textDir(locale)}>{solution.title}</h3>
            <div className="toolbar">
              <button
                type="button"
                className="ghost-button"
                disabled={readOnly || busy !== null}
                onClick={() => void run(solution.id)}
              >
                {busy === solution.id ? t.running : view ? t.again : t.run}
              </button>
            </div>
            {failed === solution.id && (
              <p className="notice error" role="alert">
                {t.failed}
              </p>
            )}
            {view && (
              <>
                {view.findings.length === 0 && <p role="status">{t.none}</p>}
                {view.dropped > 0 && (
                  <p className="muted">
                    <small>{t.dropped(formatNumber(locale, view.dropped))}</small>
                  </p>
                )}
                {!view.independentModel && view.findings.length > 0 && (
                  <p className="muted">
                    <small>{t.sameModel}</small>
                  </p>
                )}
                {view.findings.map((finding) => {
                  const given = answers[solution.id]?.[finding.title] ?? { answer: '', reason: '' };
                  const must = MUST_ANSWER.includes(finding.severity);
                  const idBase = `crit-${solution.id}-${finding.title}`.replace(/\s+/gu, '-');
                  return (
                    <div key={finding.title} className="card stack" dir={textDir(locale)}>
                      <p>
                        <span className={`badge ${severityBadge[finding.severity]}`}>
                          {t.severities[finding.severity]}
                        </span>{' '}
                        <span className="badge">{t.lenses[finding.lens]}</span>{' '}
                        <strong>{finding.title}</strong>
                      </p>
                      <p>{finding.claim}</p>
                      <ul className="output-list">
                        {finding.basis.map((b, index) => (
                          <li key={index}>
                            <small>{t.kinds[b.kind] ?? b.kind}:</small> <q>{b.quote}</q>
                          </li>
                        ))}
                      </ul>
                      <p>
                        <strong>{t.earlySign}:</strong> {finding.earlySign}
                      </p>
                      <p>
                        <strong>{t.control}:</strong> {finding.control}
                      </p>
                      <div className="field">
                        <label htmlFor={`${idBase}-answer`}>
                          {t.answer}
                          {must ? ` — ${t.required}` : ''}
                        </label>
                        <select
                          id={`${idBase}-answer`}
                          value={given.answer}
                          onChange={(event) =>
                            onAnswer(solution.id, finding.title, {
                              ...given,
                              answer: event.target.value as CritiqueAnswer | '',
                            })
                          }
                        >
                          {(['', 'accept', 'mitigate', 'reject'] as const).map((value) => (
                            <option key={value} value={value}>
                              {t.answers[value]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {given.answer !== '' && given.answer !== 'accept' && (
                        <div className="field">
                          <label htmlFor={`${idBase}-reason`}>{t.reason}</label>
                          <input
                            id={`${idBase}-reason`}
                            value={given.reason}
                            maxLength={200}
                            onChange={(event) =>
                              onAnswer(solution.id, finding.title, {
                                ...given,
                                reason: event.target.value,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
