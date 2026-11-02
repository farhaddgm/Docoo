'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { SectionTitle } from '../../../info-tip';
import { ApiError, apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatNumber, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

type Channel = 'knowledge' | 'web' | 'both';

interface OpenQuestion {
  id: string;
  question: string;
  channel: Channel;
}

interface Data {
  plan: {
    versionNo: number;
    confirmed: { at: string } | null;
    questions: { question: string; why: string; channel: Channel }[];
  } | null;
  limits: { maxQuestions: number };
  followup: {
    atGate: boolean;
    hasPlan: boolean;
    planChanged: boolean;
    open: OpenQuestion[];
    rounds: number;
  } | null;
}

interface GapItem {
  requirement: { id: string; text: string };
  verdict: 'supported' | 'partial' | 'missing' | 'unchecked';
  evidence: string;
  suggestion: { question: string; why: string; channel: Channel } | null;
}

const copy = {
  fa: {
    title: 'تکمیل شکاف‌های تحقیق',
    help: 'پرسش‌هایی که تحقیق برایشان پاسخ با پشتوانه پیدا نکرد، اینجا می‌آیند. یک دور تکمیلی فقط روی همین‌ها کار می‌کند و یافته‌های پرسش‌های پاسخ‌داده‌شده را دست‌نخورده نگه می‌دارد.',
    open: 'پرسش‌های باز',
    none: 'پرسش بازی نمانده است.',
    channels: { knowledge: 'دانش داخلی', web: 'وب', both: 'دانش داخلی و وب' },
    run: 'اجرای دور تکمیلی',
    running: 'در حال ثبت…',
    note: 'این کار خروجی فعلی را رد می‌کند و یک تلاش تازه می‌سازد که از سقف تلاش‌ها حساب می‌شود؛ نتیجه به همین خروجی افزوده می‌شود.',
    notAtGate: 'دور تکمیلی فقط وقتی ممکن است که خروجی منتظر بازبینی شماست (تب «گردش‌کار»).',
    noPlan:
      'این تحقیق بدون برنامه انجام شده؛ برای دور تکمیلی ابتدا برنامه بنویسید و تحقیق را از نو اجرا کنید.',
    planChanged:
      'برنامه بعد از این خروجی بازنویسی شده است. برای اعمالش «درخواست بازبینی» بفرستید یا مرحله را از نو اجرا کنید.',
    unconfirmed: 'برنامه تازه‌ای تأیید نشده؛ پس از تأییدش پرسش‌های تازه هم اینجا می‌آیند.',
    rounds: '{n} دور تکمیلی تاکنون انجام شده است.',
    gapsTitle: 'پوشش الزامات خروجی در تحقیق',
    gapsHelp:
      'الزام‌های «باید داشته باشد» را با یافته‌های تحقیق می‌سنجد و برای هر کدام که پشتوانه ندارد، یک پرسش پیشنهاد می‌دهد. این کار یک فراخوانی مدل است.',
    gapsRun: 'بررسی الزامات',
    gapsRunning: 'در حال بررسی…',
    verdicts: {
      supported: 'دارای پشتوانه',
      partial: 'ناقص',
      missing: 'بدون پشتوانه',
      unchecked: 'سنجیده نشد',
    },
    suggested: 'پرسش پیشنهادی',
    addToPlan: 'افزودن به برنامه تحقیق',
    added: 'به برنامه افزوده شد؛ نسخه تازه را در «برنامه تحقیق» تأیید کنید، سپس دور تکمیلی بگیرید.',
    errors: {
      RESEARCH_FOLLOWUP_NOT_AT_GATE: 'خروجی اکنون منتظر بازبینی شما نیست.',
      RESEARCH_FOLLOWUP_PLAN_CHANGED: 'برنامه بعد از این خروجی بازنویسی شده است.',
      RESEARCH_FOLLOWUP_NOTHING_OPEN: 'پرسش بازی نمانده است.',
      RESEARCH_FOLLOWUP_NOT_OPEN: 'فقط پرسش‌های باز را انتخاب کنید.',
      RESEARCH_FOLLOWUP_NO_PLAN: 'این تحقیق بدون برنامه انجام شده است.',
      RESEARCH_GAPS_NO_REQUIREMENTS: 'ابتدا دست‌کم یک الزام «باید داشته باشد» بنویسید.',
      RESEARCH_GAPS_NO_RESEARCH: 'تحقیق هنوز خروجی نداده است.',
      RESEARCH_GAPS_CHECK_FAILED: 'بررسی انجام نشد. دوباره تلاش کنید.',
      RESEARCH_PLAN_INVALID_REQUEST:
        'پرسش پیشنهادی را نمی‌توان افزود؛ شاید تکراری است یا برنامه پر است.',
      RESEARCH_PLAN_VERSION_CONFLICT: 'برنامه در این فاصله تغییر کرد؛ دوباره تلاش کنید.',
      AI_NOT_CONFIGURED: 'هوش مصنوعی هنوز تنظیم نشده است.',
      WORKFLOW_OUTPUT_SUPERSEDED: 'این نسخه از خروجی عوض شده است؛ صفحه را تازه کنید.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
  },
  en: {
    title: 'Fill the research gaps',
    help: 'Questions the research found no supported answer for appear here. A follow-up round works on those only and keeps the findings of the answered questions untouched.',
    open: 'Open questions',
    none: 'No question is left open.',
    channels: { knowledge: 'Internal knowledge', web: 'Web', both: 'Internal knowledge and web' },
    run: 'Run a follow-up round',
    running: 'Starting…',
    note: 'This rejects the current output and starts a new attempt, which counts against the attempt limit; the result is added to this output.',
    notAtGate: 'A follow-up round needs the output to wait for your review (the Workflow tab).',
    noPlan:
      'This research ran without a plan; write a plan and redo the stage to use follow-up rounds.',
    planChanged:
      'The plan was rewritten after this output. Send a revision request or redo the stage to apply it.',
    unconfirmed:
      'A newer plan is not confirmed yet; once it is, its new questions appear here too.',
    rounds: '{n} follow-up round(s) so far.',
    gapsTitle: 'Do the output requirements have research behind them?',
    gapsHelp:
      'Compares the “must have” requirements with the research findings and, for each one without support, proposes a question. This costs one model call.',
    gapsRun: 'Check the requirements',
    gapsRunning: 'Checking…',
    verdicts: {
      supported: 'Supported',
      partial: 'Partial',
      missing: 'Unsupported',
      unchecked: 'Not checked',
    },
    suggested: 'Suggested question',
    addToPlan: 'Add to the research plan',
    added:
      'Added to the plan; confirm the new version in “Research plan”, then run a follow-up round.',
    errors: {
      RESEARCH_FOLLOWUP_NOT_AT_GATE: 'The output is not waiting for your review now.',
      RESEARCH_FOLLOWUP_PLAN_CHANGED: 'The plan was rewritten after this output.',
      RESEARCH_FOLLOWUP_NOTHING_OPEN: 'No question is left open.',
      RESEARCH_FOLLOWUP_NOT_OPEN: 'Choose open questions only.',
      RESEARCH_FOLLOWUP_NO_PLAN: 'This research ran without a plan.',
      RESEARCH_GAPS_NO_REQUIREMENTS: 'Write at least one “must have” requirement first.',
      RESEARCH_GAPS_NO_RESEARCH: 'The research has no output yet.',
      RESEARCH_GAPS_CHECK_FAILED: 'The check did not work. Try again.',
      RESEARCH_PLAN_INVALID_REQUEST:
        'The suggested question cannot be added; it may repeat one or the plan is full.',
      RESEARCH_PLAN_VERSION_CONFLICT: 'The plan changed meanwhile; try again.',
      AI_NOT_CONFIGURED: 'AI is not configured yet.',
      WORKFLOW_OUTPUT_SUPERSEDED: 'This output version was replaced; reload the page.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
  },
} as const;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

const VERDICT_TONE: Record<GapItem['verdict'], string> = {
  supported: 'tone-ok',
  partial: 'tone-warn',
  missing: 'tone-danger',
  unchecked: 'tone-neutral',
};

/**
 * ADR-0039: the next step after a research output — a follow-up round on the open questions,
 * and a check of the "must" output requirements against the research that can add questions to
 * the plan. Shown on the research tab once the stage has an output.
 */
export function ResearchFollowupPanel({
  locale,
  base,
  refreshKey = 0,
  onChanged,
  onPlanChanged,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  refreshKey?: number;
  /** Called after a round was requested, so the other tabs follow. */
  onChanged: () => void;
  /** Called after a question was added to the plan, so the plan card reloads. */
  onPlanChanged: () => void;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'followup' | 'gaps' | 'add' | null>(null);
  const [error, setError] = useState('');
  const [gaps, setGaps] = useState<GapItem[] | null>(null);
  const [added, setAdded] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Data>(`${base}/research-plan`));
    } catch {
      setData(null);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function act(kind: 'followup' | 'gaps' | 'add', work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError('');
    try {
      await work();
    } catch (caught) {
      setError(
        (caught instanceof ApiError && caught.code && text.errors[caught.code]) || text.generic,
      );
    } finally {
      setBusy(null);
      await load();
    }
  }

  const followup = data?.followup;
  if (!data || !followup) return null;
  const selected = chosen ?? followup.open.map((item) => item.id);

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <SectionTitle id={`${id}-title`} help={text.help}>
        {text.title}
      </SectionTitle>
      {followup.rounds > 0 && (
        <p className="muted">{fill(text.rounds, { n: formatNumber(locale, followup.rounds) })}</p>
      )}

      {!followup.hasPlan ? (
        <p className="notice" role="note">
          {text.noPlan}
        </p>
      ) : followup.planChanged ? (
        <p className="notice warn" role="status">
          {text.planChanged}
        </p>
      ) : data.plan && !data.plan.confirmed ? (
        <p className="notice" role="note">
          {text.unconfirmed}
        </p>
      ) : followup.open.length === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <>
          <fieldset className="field-stack">
            <legend>{text.open}</legend>
            {followup.open.map((item) => (
              <label key={item.id} className="check-row">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={readOnly || busy !== null}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((value) => value !== item.id),
                    )
                  }
                />{' '}
                <strong>{item.id}</strong> <span dir={textDir(locale)}>{item.question}</span>{' '}
                <span className="badge">{text.channels[item.channel]}</span>
              </label>
            ))}
          </fieldset>
          {!followup.atGate && (
            <p className="muted" role="note">
              {text.notAtGate}
            </p>
          )}
          {!readOnly && (
            <div className="stack">
              <div className="toolbar">
                <button
                  data-write-action
                  className="primary-button"
                  type="button"
                  disabled={busy !== null || !followup.atGate || selected.length === 0}
                  onClick={() =>
                    void act('followup', async () => {
                      await apiSend(
                        'POST',
                        `${base}/research-plan/followup`,
                        { questionIds: selected },
                        { headers: { 'idempotency-key': idempotencyKey() } },
                      );
                      setChosen(null);
                      onChanged();
                    })
                  }
                >
                  {busy === 'followup' ? text.running : text.run}
                </button>
              </div>
              <small className="muted">{text.note}</small>
            </div>
          )}
        </>
      )}

      <hr />
      <SectionTitle as="h3" help={text.gapsHelp}>
        {text.gapsTitle}
      </SectionTitle>
      {!readOnly && (
        <div className="toolbar">
          <button
            data-write-action
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void act('gaps', async () => {
                setAdded(false);
                const result = await apiSend<{ items: GapItem[] }>(
                  'POST',
                  `${base}/research-plan/requirement-gaps`,
                );
                setGaps(result.items);
              })
            }
          >
            {busy === 'gaps' ? text.gapsRunning : text.gapsRun}
          </button>
        </div>
      )}
      {gaps && (
        <ul className="plain-list">
          {gaps.map((item) => (
            <li key={item.requirement.id}>
              <span className={`badge ${VERDICT_TONE[item.verdict]}`}>
                {text.verdicts[item.verdict]}
              </span>
              <p dir={textDir(locale)}>{item.requirement.text}</p>
              {item.evidence && (
                <p className="muted" dir={textDir(locale)}>
                  {item.evidence}
                </p>
              )}
              {item.suggestion && (
                <div className="stack">
                  <p dir={textDir(locale)}>
                    <small className="muted">{text.suggested}: </small>
                    {item.suggestion.question}{' '}
                    <span className="badge">{text.channels[item.suggestion.channel]}</span>
                  </p>
                  {!readOnly && (
                    <div className="toolbar compact">
                      <button
                        data-write-action
                        className="secondary-button"
                        type="button"
                        disabled={
                          busy !== null ||
                          !data.plan ||
                          data.plan.questions.length >= data.limits.maxQuestions
                        }
                        onClick={() =>
                          void act('add', async () => {
                            await apiSend('PUT', `${base}/research-plan`, {
                              questions: [
                                ...data.plan!.questions.map(({ question, why, channel }) => ({
                                  question,
                                  why,
                                  channel,
                                })),
                                item.suggestion,
                              ],
                              basedOnVersionNo: data.plan!.versionNo,
                            });
                            setAdded(true);
                            onPlanChanged();
                          })
                        }
                      >
                        {text.addToPlan}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {added && (
        <p className="notice" role="status">
          {text.added}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
