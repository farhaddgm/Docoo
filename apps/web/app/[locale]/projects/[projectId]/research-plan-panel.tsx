'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { SectionTitle } from '../../../info-tip';
import { ApiError, apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../i18n';
import { useReadOnlyAccess } from '../../resource-access';

type Channel = 'knowledge' | 'web' | 'both';

interface Question {
  id?: string;
  question: string;
  why: string;
  channel: Channel;
}

interface Plan {
  id: string;
  versionNo: number;
  source: 'system' | 'ai' | 'admin';
  createdAt: string;
  questions: (Question & { id: string })[];
  confirmed: { at: string } | null;
}

interface Data {
  plan: Plan | null;
  required: boolean;
  webEnabled: boolean;
  limits: { maxQuestions: number; question: number; why: number };
  analysisReady: boolean;
  staleAgainstAnalysis: boolean;
  waiting: boolean;
  started: boolean;
}

const copy = {
  fa: {
    title: 'برنامه تحقیق',
    help: 'پرسش‌هایی که تحقیق باید جواب بدهد. ایجنت برای همین پرسش‌ها شاهد پیدا می‌کند و یافته‌ها زیر هر پرسش می‌آیند. اگر برنامه ننویسید، تحقیق مثل قبل از روی تعریف مسئله انجام می‌شود.',
    waiting: 'تحقیق منتظر تأیید این برنامه است. بدون هیچ پرسشی هم می‌توانید ادامه دهید.',
    notReady: 'تحلیل هنوز تأیید نشده؛ برنامه تحقیق بهتر است بعد از آن نوشته شود.',
    stale:
      'تعریف مسئله بعد از نوشتن این برنامه عوض شده است. پرسش‌ها را مرور کنید یا پیشنهاد تازه بگیرید.',
    started:
      'تحقیق یک بار اجرا شده است؛ برنامه تازه در تلاش بعدی (بازبینی یا انجام دوباره) به کار می‌رود.',
    webOff: 'جستجوی وب خاموش است؛ پرسش‌های «وب» و «هر دو» فقط از دانش داخلی جواب می‌گیرند.',
    empty: 'هنوز پرسشی ندارید.',
    emptyConfirmed: 'این برنامه پرسشی ندارد؛ تحقیق مثل قبل از روی تعریف مسئله انجام می‌شود.',
    version: 'نسخه {n}',
    sources: { system: 'خالی', ai: 'پیشنهاد هوش مصنوعی', admin: 'ویرایش ادمین' },
    confirmed: 'تأییدشده در {at}',
    unconfirmed: 'تأیید نشده',
    channels: { knowledge: 'دانش داخلی', web: 'وب', both: 'دانش داخلی و وب' },
    question: 'پرسش',
    why: 'چرا لازم است (اختیاری)',
    channel: 'منبع جواب',
    propose: 'پیشنهاد با هوش مصنوعی',
    proposing: 'در حال نوشتن پیشنهاد…',
    proposeNote: 'پیشنهاد تازه نسخه جدیدی می‌سازد و باید دوباره تأیید شود.',
    edit: 'ویرایش برنامه',
    add: 'افزودن پرسش',
    remove: 'حذف',
    save: 'ذخیره نسخه جدید',
    cancel: 'انصراف',
    confirm: 'تأیید برنامه',
    confirmStart: 'تأیید و شروع تحقیق',
    confirmNone: 'ادامه بدون برنامه',
    confirming: 'در حال تأیید…',
    errors: {
      AI_NOT_CONFIGURED: 'هوش مصنوعی هنوز تنظیم نشده است.',
      RESEARCH_PLAN_PROPOSAL_FAILED: 'پیشنهاد ساخته نشد. دوباره تلاش کنید یا خودتان بنویسید.',
      RESEARCH_PLAN_VERSION_CONFLICT: 'برنامه در این فاصله تغییر کرد؛ صفحه را تازه کنید.',
      RESEARCH_PLAN_ALREADY_CONFIRMED: 'این برنامه قبلا تأیید شده است.',
      RESEARCH_PLAN_INVALID_REQUEST: 'هر پرسش متنی دست‌کم پنج‌حرفی و غیرتکراری لازم دارد.',
    } as Record<string, string>,
    generic: 'انجام نشد. دوباره تلاش کنید.',
    loadFailed: 'برنامه تحقیق بارگذاری نشد.',
  },
  en: {
    title: 'Research plan',
    help: 'The questions the research must answer. The agent looks for evidence for exactly these questions and the findings appear under each one. If you write no plan, research works from the problem definition as before.',
    waiting:
      'Research is waiting for this plan to be confirmed. You can also go on with no question.',
    notReady: 'The analysis is not approved yet; the research plan is better written after it.',
    stale:
      'The problem definition changed after this plan was written. Review the questions or ask for a new proposal.',
    started:
      'Research has run once; a new plan is used by the next attempt (a revision or a redo).',
    webOff:
      'Web search is off; “Web” and “Both” questions are answered from internal knowledge only.',
    empty: 'You have no question yet.',
    emptyConfirmed:
      'This plan has no question; research works from the problem definition as before.',
    version: 'Version {n}',
    sources: { system: 'Empty', ai: 'AI proposal', admin: 'Edited by the administrator' },
    confirmed: 'Confirmed {at}',
    unconfirmed: 'Not confirmed',
    channels: { knowledge: 'Internal knowledge', web: 'Web', both: 'Internal knowledge and web' },
    question: 'Question',
    why: 'Why it matters (optional)',
    channel: 'Where to look',
    propose: 'Propose with AI',
    proposing: 'Writing a proposal…',
    proposeNote: 'A new proposal makes a new version that must be confirmed again.',
    edit: 'Edit the plan',
    add: 'Add a question',
    remove: 'Remove',
    save: 'Save as a new version',
    cancel: 'Cancel',
    confirm: 'Confirm the plan',
    confirmStart: 'Confirm and start research',
    confirmNone: 'Go on without a plan',
    confirming: 'Confirming…',
    errors: {
      AI_NOT_CONFIGURED: 'AI is not configured yet.',
      RESEARCH_PLAN_PROPOSAL_FAILED: 'No proposal was made. Try again or write it yourself.',
      RESEARCH_PLAN_VERSION_CONFLICT: 'The plan changed meanwhile; reload the page.',
      RESEARCH_PLAN_ALREADY_CONFIRMED: 'This plan is already confirmed.',
      RESEARCH_PLAN_INVALID_REQUEST:
        'Each question needs text of at least five characters, and no question may repeat.',
    } as Record<string, string>,
    generic: 'It did not work. Try again.',
    loadFailed: 'The research plan could not be loaded.',
  },
} as const;

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

const blank = (): Question => ({ question: '', why: '', channel: 'both' });

/**
 * ADR-0038: the research plan, shown on the research tab. Research waits for its confirmation;
 * editing or proposing makes a new version that needs confirming again. Confirming a plan with no
 * question is the way to go on without one.
 */
export function ResearchPlanPanel({
  locale,
  base,
  refreshKey = 0,
  onChanged,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
  refreshKey?: number;
  onChanged: () => void;
}) {
  const text = copy[locale];
  const readOnly = useReadOnlyAccess();
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Question[] | null>(null);
  const [busy, setBusy] = useState<'propose' | 'save' | 'confirm' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Data>(`${base}/research-plan`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function act(kind: 'propose' | 'save' | 'confirm', work: () => Promise<void>) {
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

  if (failed && !data) {
    return (
      <section className="card" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{text.title}</h2>
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      </section>
    );
  }
  if (!data) return null;

  const plan = data.plan;
  const confirmed = Boolean(plan?.confirmed);
  const count = plan?.questions.length ?? 0;
  const usesWeb = (plan?.questions ?? []).some((item) => item.channel !== 'knowledge');
  const update = (index: number, change: Partial<Question>) =>
    setDraft(
      (rows) => rows?.map((row, at) => (at === index ? { ...row, ...change } : row)) ?? rows,
    );

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <SectionTitle id={`${id}-title`} help={text.help}>
        {text.title}
      </SectionTitle>
      {data.waiting && !confirmed && (
        <p className="notice" role="status">
          {text.waiting}
        </p>
      )}
      {!data.analysisReady && !confirmed && (
        <p className="notice" role="note">
          {text.notReady}
        </p>
      )}
      {data.staleAgainstAnalysis && (
        <p className="notice warn" role="status">
          {text.stale}
        </p>
      )}
      {data.started && (
        <p className="muted" role="note">
          {text.started}
        </p>
      )}
      {plan && (
        <p className="muted">
          {fill(text.version, { n: formatNumber(locale, plan.versionNo) })} ·{' '}
          {text.sources[plan.source]} ·{' '}
          {plan.confirmed
            ? fill(text.confirmed, { at: formatDateTime(locale, plan.confirmed.at) })
            : text.unconfirmed}
        </p>
      )}
      {!data.webEnabled && usesWeb && (
        <p className="notice" role="note">
          {text.webOff}
        </p>
      )}

      {draft ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void act('save', async () => {
              await apiSend('PUT', `${base}/research-plan`, {
                questions: draft.map(({ question, why, channel }) => ({ question, why, channel })),
                basedOnVersionNo: plan?.versionNo ?? 0,
              });
              setDraft(null);
            });
          }}
        >
          {draft.map((row, index) => (
            <fieldset key={index} className="field-stack">
              <legend>{`Q${formatNumber(locale, index + 1)}`}</legend>
              <label htmlFor={`${id}-q-${index}`}>{text.question}</label>
              <textarea
                id={`${id}-q-${index}`}
                rows={2}
                dir={textDir(locale)}
                maxLength={data.limits.question}
                value={row.question}
                required
                onChange={(event) => update(index, { question: event.target.value })}
              />
              <label htmlFor={`${id}-w-${index}`}>{text.why}</label>
              <input
                id={`${id}-w-${index}`}
                dir={textDir(locale)}
                maxLength={data.limits.why}
                value={row.why}
                onChange={(event) => update(index, { why: event.target.value })}
              />
              <label htmlFor={`${id}-c-${index}`}>{text.channel}</label>
              <select
                id={`${id}-c-${index}`}
                value={row.channel}
                onChange={(event) => update(index, { channel: event.target.value as Channel })}
              >
                {(['both', 'knowledge', 'web'] as const).map((channel) => (
                  <option key={channel} value={channel}>
                    {text.channels[channel]}
                  </option>
                ))}
              </select>
              <div className="toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDraft(draft.filter((_, at) => at !== index))}
                >
                  {text.remove}
                </button>
              </div>
            </fieldset>
          ))}
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={draft.length >= data.limits.maxQuestions}
              onClick={() => setDraft([...draft, blank()])}
            >
              {text.add}
            </button>
            <button className="primary-button" type="submit" disabled={busy !== null}>
              {text.save}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => setDraft(null)}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      ) : (
        <>
          {count === 0 ? (
            <p className="muted">{confirmed ? text.emptyConfirmed : text.empty}</p>
          ) : (
            <ol className="plain-list">
              {plan!.questions.map((item) => (
                <li key={item.id}>
                  <strong>{item.id}</strong> <span dir={textDir(locale)}>{item.question}</span>{' '}
                  <span className="badge">{text.channels[item.channel]}</span>
                  {item.why && (
                    <p className="muted" dir={textDir(locale)}>
                      {item.why}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {!readOnly && (
            <div className="stack">
              <div className="toolbar">
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null || confirmed}
                  onClick={() =>
                    void act('propose', async () => {
                      await apiSend('POST', `${base}/research-plan/propose`);
                    })
                  }
                >
                  {busy === 'propose' ? text.proposing : text.propose}
                </button>
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    setDraft(
                      count > 0
                        ? plan!.questions.map(({ question, why, channel }) => ({
                            question,
                            why,
                            channel,
                          }))
                        : [blank()],
                    )
                  }
                >
                  {text.edit}
                </button>
                <button
                  data-write-action
                  className="primary-button"
                  type="button"
                  disabled={busy !== null || !plan || confirmed}
                  onClick={() =>
                    void act('confirm', async () => {
                      await apiSend(
                        'POST',
                        `${base}/research-plan/confirm`,
                        { versionNo: plan!.versionNo },
                        { headers: { 'idempotency-key': idempotencyKey() } },
                      );
                      onChanged();
                    })
                  }
                >
                  {busy === 'confirm'
                    ? text.confirming
                    : count === 0
                      ? text.confirmNone
                      : data.waiting
                        ? text.confirmStart
                        : text.confirm}
                </button>
              </div>
              {!confirmed && <small className="muted">{text.proposeNote}</small>}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
