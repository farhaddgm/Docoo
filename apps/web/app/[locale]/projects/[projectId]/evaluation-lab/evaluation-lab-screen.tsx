'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  evaluationBlindReviewPackSchema,
  evaluationComparisonPageSchema,
  evaluationExperimentPageSchema,
  type EvaluationBlindReviewInput,
  type EvaluationBlindReviewPack,
  type EvaluationExperimentSummary,
  type EvaluationSavedComparison,
} from '@docoo/contracts';
import { ProjectAccessBoundary, useReadOnlyAccess } from '../../../resource-access';
import { SignedIn } from '../../../signed-in';
import { buildEvaluationReview, type EvaluationRatingDraft } from './evaluation-lab-form';

type Locale = 'fa' | 'en';
class LabRequestError extends Error {
  constructor(readonly status: number) {
    super('Evaluation request failed');
  }
}
const words = {
  fa: {
    title: 'مقایسهٔ کیفیت ایجنت‌ها',
    intro:
      'دو نسخه را روی پرونده‌های یکسان مقایسه کنید. نمره‌های کیفیت را بازبین انسانی ثبت می‌کند.',
    back: 'بازگشت به پروژه',
    refresh: 'تازه‌سازی',
    loading: 'در حال بارگذاری…',
    empty: 'هنوز آزمایشی برای این پروژه ثبت نشده است.',
    unavailable: 'اطلاعات بارگذاری نشد؛ دوباره تلاش کنید.',
    guest: 'برای مشاهدهٔ آزمایش‌ها وارد حساب شوید.',
    denied: 'پروژه پیدا نشد یا دسترسی شما کافی نیست.',
    login: 'ورود',
    older: 'آزمایش‌های قدیمی‌تر',
    history: 'آزمایش‌های ثبت‌شده',
    cases: 'پرونده',
    results: 'خروجی ثبت‌شده',
    reviews: 'بازبینی',
    review: 'بازبینی بدون نمایش مدل',
    comparisons: 'مقایسه‌های ثبت‌شده',
    blind: 'بازبینی بدون نمایش مدل',
    blindHelp:
      'نام مدل و نسخه هنگام امتیازدهی پنهان است و ترتیب A و B در هر پرونده تغییر می‌کند. هر دو خروجی را با ورودی و معیار یکسان بررسی کنید.',
    rubric: 'راهنمای امتیازدهی',
    input: 'ورودی مشترک',
    expected: 'مواردی که باید بررسی شوند',
    output: 'خروجی',
    score: 'نمرهٔ کیفیت (۰ تا ۱۰۰)',
    citations: 'تعداد خطاهای ارجاع',
    accepted: 'پذیرش انسانی',
    choose: 'انتخاب کنید',
    yes: 'پذیرفتنی',
    no: 'نیازمند اصلاح',
    unassessed: 'پذیرش را بررسی نکرده‌ام',
    previous: 'پرونده‌های قبلی',
    next: 'پرونده‌های بعدی',
    submit: 'ثبت بازبینی و محاسبهٔ مقایسه',
    saving: 'در حال ثبت…',
    missing: 'برای همهٔ خروجی‌ها نمره، تعداد خطای ارجاع و وضعیت پذیرش را کامل کنید.',
    saved: 'بازبینی ذخیره شد و مقایسه محاسبه شد.',
    saveFailed: 'بازبینی ثبت نشد. دوباره تلاش کنید؛ پاسخ‌های واردشده حفظ شده‌اند.',
    stale: 'خروجی‌های این آزمایش تغییر کرده‌اند یا کامل نیستند. اطلاعات را تازه کنید.',
    readonly: 'دسترسی شما فقط مشاهده است.',
    close: 'بستن جزئیات',
    synthetic: 'این مجموعه مصنوعی است؛ نتایج آن را به همهٔ پروژه‌ها تعمیم ندهید.',
    noReports: 'هنوز مقایسهٔ انسانی ثبت نشده است.',
    language: 'زبان',
    all: 'کل مجموعه',
    fa: 'فارسی',
    en: 'انگلیسی',
    size: 'تعداد پرونده',
    quality: 'نمرهٔ مبنا / آزمایشی (تغییر)',
    regressions: 'پرونده‌های پسرفت',
    citationDelta: 'تغییر خطای ارجاع',
    cost: 'هزینهٔ کامل: مبنا / آزمایشی (دلار)',
    latency: 'زمان صدک ۹۵: مبنا / آزمایشی (میلی‌ثانیه)',
    unknown: 'نامعلوم',
    baseline: 'نسخهٔ مبنا',
    candidate: 'نسخهٔ آزمایشی',
    median: 'زمان میانه: مبنا / آزمایشی (میلی‌ثانیه)',
    agreement: 'توافق ارزیاب مدل با انسان: مبنا / آزمایشی',
    measured: 'پروندهٔ دارای هزینهٔ معلوم',
    manual:
      'این گزارش مدل پیش‌فرض یا تصمیم تأیید پروژه را تغییر نمی‌دهد. هزینه یا زمان اندازه‌گیری‌نشده «نامعلوم» است.',
    status: {
      running: 'در حال اجرا',
      completed: 'کامل‌شده',
      failed: 'ناموفق',
      cancelled: 'لغوشده',
    },
  },
  en: {
    title: 'Agent quality comparison',
    intro: 'Compare two versions on identical cases. A human reviewer supplies the quality labels.',
    back: 'Back to project',
    refresh: 'Refresh',
    loading: 'Loading…',
    empty: 'No experiment has been recorded for this project yet.',
    unavailable: 'Data could not be loaded. Try again.',
    guest: 'Sign in to view experiments.',
    denied: 'The project is unavailable or access is insufficient.',
    login: 'Sign in',
    older: 'Older experiments',
    history: 'Recorded experiments',
    cases: 'cases',
    results: 'recorded outputs',
    reviews: 'reviews',
    review: 'Review with model names hidden',
    comparisons: 'Recorded comparisons',
    blind: 'Review with model names hidden',
    blindHelp:
      'Model and version names are hidden while rating. A/B order varies between cases. Review both outputs against the same input and rubric.',
    rubric: 'Scoring guide',
    input: 'Shared input',
    expected: 'Review these invariants',
    output: 'Output',
    score: 'Quality score (0–100)',
    citations: 'Citation error count',
    accepted: 'Human acceptance',
    choose: 'Choose',
    yes: 'Acceptable',
    no: 'Needs revision',
    unassessed: 'Acceptance not assessed',
    previous: 'Previous cases',
    next: 'Next cases',
    submit: 'Save review and calculate comparison',
    saving: 'Saving…',
    missing: 'Complete score, citation error count and acceptance for every output.',
    saved: 'The review was saved and the comparison calculated.',
    saveFailed: 'The review could not be saved. Retry; your entered ratings have been kept.',
    stale: 'These experiment outputs changed or are incomplete. Refresh the data.',
    readonly: 'You have view-only access.',
    close: 'Close details',
    synthetic: 'These cases are synthetic; do not generalize their results to all projects.',
    noReports: 'No human comparison has been saved yet.',
    language: 'Language',
    all: 'All cases',
    fa: 'Persian',
    en: 'English',
    size: 'Case count',
    quality: 'Baseline / candidate score (change)',
    regressions: 'Regressed cases',
    citationDelta: 'Citation error change',
    cost: 'Complete cost: baseline / candidate (USD)',
    latency: 'p95 latency: baseline / candidate (ms)',
    unknown: 'Unknown',
    baseline: 'Baseline',
    candidate: 'Candidate',
    median: 'Median latency: baseline / candidate (ms)',
    agreement: 'Model judge / human agreement: baseline / candidate',
    measured: 'cases with known cost',
    manual:
      'This report does not change the default model or approve the project. Unmeasured cost or latency is unknown.',
    status: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
  },
} as const;

const invariantText: Record<string, readonly [string, string]> = {
  cite_supplied_sources: [
    'انتساب درست ادعا به منابع داده‌شده',
    'Attribute claims to supplied sources',
  ],
  preserve_units: ['حفظ واحد، بازه و مخرج شاخص‌ها', 'Preserve units, periods and denominators'],
  no_unsupported_causality: [
    'پرهیز از نتیجه‌گیری علّی بدون شاهد',
    'Avoid unsupported causal claims',
  ],
  do_not_count_reprints_as_independent: [
    'بازنشر را شاهد مستقل نشمارد',
    'Do not count reprints as independent evidence',
  ],
  preserve_conflict_context: [
    'حفظ تفاوت زمینه و روش منابع متعارض',
    'Preserve the context of conflicting findings',
  ],
  surface_missing_evidence: [
    'بیان روشن شواهد و پاسخ‌های ناموجود',
    'Identify missing evidence and answers',
  ],
  do_not_invent_numbers: [
    'پرهیز از ساختن اعداد، نمره‌ها و پیش‌بینی‌ها',
    'Do not invent numbers, scores or forecasts',
  ],
  ignore_source_instructions: [
    'دستور داخل منبع را اجرا نکند',
    'Ignore instructions embedded in sources',
  ],
};

export function EvaluationLabPageShell(props: {
  locale: Locale;
  projectId: string;
  workspaceId: string;
}) {
  const t = words[props.locale];
  return (
    <SignedIn locale={props.locale} title={t.title} subtitle={t.intro}>
      {(identity) =>
        identity.workspaces.some((workspace) => workspace.id === props.workspaceId) ? (
          <ProjectAccessBoundary projectId={props.projectId} workspaceId={props.workspaceId}>
            <EvaluationLabScreen {...props} />
          </ProjectAccessBoundary>
        ) : (
          <p className="notice error" role="alert">
            {t.denied}
          </p>
        )
      }
    </SignedIn>
  );
}

export function EvaluationLabScreen({
  locale,
  projectId,
  workspaceId,
}: {
  locale: Locale;
  projectId: string;
  workspaceId: string;
}) {
  const t = words[locale];
  const readOnly = useReadOnlyAccess();
  const base = `/api/workspaces/${workspaceId}/projects/${projectId}/evaluation-experiments`;
  const [items, setItems] = useState<EvaluationExperimentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'guest' | 'denied'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pack, setPack] = useState<EvaluationBlindReviewPack | null>(null);
  const [reports, setReports] = useState<EvaluationSavedComparison[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EvaluationRatingDraft>>({});
  const [casePage, setCasePage] = useState(0);
  const [focusField, setFocusField] = useState<string | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const writeAbort = useRef<AbortController | null>(null);
  const pendingReview = useRef<EvaluationBlindReviewInput | null>(null);
  const pendingCommandKey = useRef<string | null>(null);
  const number = (value: number | null) =>
    value === null
      ? t.unknown
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);

  const fail = useCallback(
    (failure: unknown, fallback: string) => {
      if (failure instanceof LabRequestError && [401, 403, 404].includes(failure.status)) {
        setState(failure.status === 401 ? 'guest' : 'denied');
        setPack(null);
        setReports(null);
        setItems([]);
        setDrafts({});
        pendingReview.current = null;
        pendingCommandKey.current = null;
      } else
        setError(failure instanceof LabRequestError && failure.status === 409 ? t.stale : fallback);
    },
    [t],
  );

  const load = useCallback(
    async (after?: string) => {
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      setError('');
      try {
        const response = await fetch(
          `${base}?limit=20${after ? `&cursor=${encodeURIComponent(after)}` : ''}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new LabRequestError(response.status);
        const data = evaluationExperimentPageSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setItems((previous) =>
            after
              ? [
                  ...previous,
                  ...data.items.filter((item) => !previous.some((old) => old.id === item.id)),
                ]
              : data.items,
          );
          setCursor(data.nextCursor);
          setState('ready');
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setState('ready');
          fail(failure, t.unavailable);
        }
      }
    },
    [base, fail, t],
  );

  useEffect(() => {
    void load();
    return () => {
      listAbort.current?.abort();
      detailAbort.current?.abort();
      writeAbort.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    if (focusField) document.getElementById(focusField)?.focus();
  }, [focusField, casePage]);

  async function open(experimentId: string, kind: 'review-pack' | 'comparisons') {
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    setPack(null);
    setReports(null);
    setCasePage(0);
    pendingReview.current = null;
    pendingCommandKey.current = null;
    try {
      const response = await fetch(`${base}/${encodeURIComponent(experimentId)}/${kind}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new LabRequestError(response.status);
      const data: unknown = await response.json();
      if (!controller.signal.aborted) {
        if (kind === 'review-pack') setPack(evaluationBlindReviewPackSchema.parse(data));
        else setReports(evaluationComparisonPageSchema.parse(data).items);
      }
    } catch (failure) {
      if (!controller.signal.aborted) fail(failure, t.unavailable);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function change(itemId: string, key: keyof EvaluationRatingDraft, value: string) {
    pendingReview.current = null;
    pendingCommandKey.current = null;
    setFocusField(null);
    setDrafts((previous) => ({
      ...previous,
      [itemId]: { score: '', citationErrors: '', accepted: '', ...previous[itemId], [key]: value },
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pack || readOnly || busy) return;
    setError('');
    setNotice('');
    const parsed = buildEvaluationReview(pack, drafts, new Date().toISOString());
    if (!parsed.ok) {
      setError(t.missing);
      setCasePage(Math.floor(parsed.caseIndex / 5));
      setFocusField(`${parsed.itemId}-${parsed.field}`);
      document.getElementById(`${parsed.itemId}-${parsed.field}`)?.focus();
      return;
    }
    const input =
      pendingReview.current?.experimentHash === pack.experimentHash
        ? pendingReview.current
        : parsed.input;
    pendingReview.current = input;
    const commandKey = pendingCommandKey.current ?? crypto.randomUUID();
    pendingCommandKey.current = commandKey;
    const controller = new AbortController();
    writeAbort.current = controller;
    setBusy(true);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(pack.experimentId)}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': commandKey },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) throw new LabRequestError(response.status);
      if (!controller.signal.aborted) {
        pendingReview.current = null;
        pendingCommandKey.current = null;
        await open(pack.experimentId, 'comparisons');
        setNotice(t.saved);
        await load();
      }
    } catch (failure) {
      if (!controller.signal.aborted) fail(failure, t.saveFailed);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="evaluation-lab" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}>
      <header className="page-header">
        <a href={`/${locale}/projects/${projectId}?workspaceId=${workspaceId}`}>{t.back}</a>
      </header>
      {state === 'loading' && <p role="status">{t.loading}</p>}
      {state === 'guest' && (
        <p role="alert">
          {t.guest} <a href={`/${locale}/auth/login`}>{t.login}</a>
        </p>
      )}
      {state === 'denied' && <p role="alert">{t.denied}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {state === 'ready' && (
        <>
          <section className="card" aria-labelledby="lab-history">
            <h2 id="lab-history">{t.history}</h2>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setPack(null);
                setReports(null);
                void load();
              }}
            >
              {t.refresh}
            </button>
            {!items.length && !error && <p>{t.empty}</p>}
            <ul className="evaluation-lab-history">
              {items.map((item) => (
                <li key={item.id}>
                  <p>
                    <bdi>{item.datasetId}</bdi> — {t.status[item.status]} —{' '}
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString(locale)}
                    </time>
                  </p>
                  <p>
                    {number(item.caseCount)} {t.cases} · {number(item.resultCount)}/
                    {number(item.caseCount * 2)} {t.results} · {number(item.reviewCount)}{' '}
                    {t.reviews}
                  </p>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || item.status !== 'completed'}
                      onClick={() => void open(item.id, 'review-pack')}
                    >
                      {t.review}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void open(item.id, 'comparisons')}
                    >
                      {t.comparisons}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {cursor && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void load(cursor)}
              >
                {t.older}
              </button>
            )}
          </section>
          {busy && <p role="status">{t.loading}</p>}
          {pack && (
            <section className="card" aria-labelledby="lab-review">
              <h2 id="lab-review">{t.blind}</h2>
              <p>{t.blindHelp}</p>
              <p>{t.synthetic}</p>
              <details>
                <summary>{t.rubric}</summary>
                <p className="evaluation-lab-text">{pack.rubric}</p>
              </details>
              {readOnly && <p role="status">{t.readonly}</p>}
              <form noValidate onSubmit={(event) => void submit(event)}>
                {pack.cases.slice(casePage * 5, casePage * 5 + 5).map((testCase) => (
                  <article
                    className="evaluation-lab-case"
                    key={testCase.caseId}
                    lang={locale}
                    dir={locale === 'fa' ? 'rtl' : 'ltr'}
                  >
                    <h3>
                      <bdi>{testCase.caseId}</bdi>
                    </h3>
                    <h4>{t.input}</h4>
                    <p className="evaluation-lab-text" lang={testCase.language} dir="auto">
                      {testCase.input}
                    </p>
                    <h4>{t.expected}</h4>
                    <ul>
                      {testCase.expectedInvariantIds.map((id) => (
                        <li key={id}>{invariantText[id]?.[locale === 'fa' ? 0 : 1] ?? id}</li>
                      ))}
                    </ul>
                    <div className="evaluation-lab-outputs">
                      {testCase.variants.map((variant) => (
                        <div key={variant.itemId}>
                          <h4>
                            {t.output} {variant.label}
                          </h4>
                          <p className="evaluation-lab-text" lang={testCase.language} dir="auto">
                            {variant.output}
                          </p>
                          <fieldset disabled={readOnly || busy}>
                            <legend>
                              {t.output} {variant.label}
                            </legend>
                            <label htmlFor={`${variant.itemId}-score`}>{t.score}</label>
                            <input
                              id={`${variant.itemId}-score`}
                              inputMode="decimal"
                              value={drafts[variant.itemId]?.score ?? ''}
                              onChange={(event) =>
                                change(variant.itemId, 'score', event.target.value)
                              }
                            />
                            <label htmlFor={`${variant.itemId}-citationErrors`}>
                              {t.citations}
                            </label>
                            <input
                              id={`${variant.itemId}-citationErrors`}
                              inputMode="numeric"
                              value={drafts[variant.itemId]?.citationErrors ?? ''}
                              onChange={(event) =>
                                change(variant.itemId, 'citationErrors', event.target.value)
                              }
                            />
                            <label htmlFor={`${variant.itemId}-accepted`}>{t.accepted}</label>
                            <select
                              id={`${variant.itemId}-accepted`}
                              value={drafts[variant.itemId]?.accepted ?? ''}
                              onChange={(event) =>
                                change(variant.itemId, 'accepted', event.target.value)
                              }
                            >
                              <option value="">{t.choose}</option>
                              <option value="yes">{t.yes}</option>
                              <option value="no">{t.no}</option>
                              <option value="unassessed">{t.unassessed}</option>
                            </select>
                          </fieldset>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || casePage === 0}
                    onClick={() => setCasePage((page) => page - 1)}
                  >
                    {t.previous}
                  </button>
                  <span>
                    {number(casePage + 1)} / {number(Math.ceil(pack.cases.length / 5))}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || (casePage + 1) * 5 >= pack.cases.length}
                    onClick={() => setCasePage((page) => page + 1)}
                  >
                    {t.next}
                  </button>
                  <button type="submit" className="primary-button" disabled={readOnly || busy}>
                    {busy ? t.saving : t.submit}
                  </button>
                </div>
              </form>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setPack(null)}
              >
                {t.close}
              </button>
            </section>
          )}
          {reports && (
            <section className="card" aria-labelledby="lab-comparisons">
              <h2 id="lab-comparisons">{t.comparisons}</h2>
              {!reports.length && <p>{t.noReports}</p>}
              {reports.map((report) => (
                <article key={report.id} className="evaluation-lab-case">
                  <h3>
                    <time dateTime={report.createdAt}>
                      {new Date(report.createdAt).toLocaleString(locale)}
                    </time>
                  </h3>
                  <p>
                    {t.baseline}:{' '}
                    <bdi>
                      {report.comparison.baseline.configuration.provider} /{' '}
                      {report.comparison.baseline.configuration.modelId}
                    </bdi>
                  </p>
                  <p>
                    {t.candidate}:{' '}
                    <bdi>
                      {report.comparison.candidate.configuration.provider} /{' '}
                      {report.comparison.candidate.configuration.modelId}
                    </bdi>
                  </p>
                  <p>{t.synthetic}</p>
                  <p>{t.manual}</p>
                  <div
                    className="evaluation-lab-table"
                    tabIndex={0}
                    role="region"
                    aria-label={t.comparisons}
                  >
                    <table>
                      <caption>{t.comparisons}</caption>
                      <thead>
                        <tr>
                          {[
                            t.language,
                            t.size,
                            t.quality,
                            t.regressions,
                            t.citationDelta,
                            t.cost,
                            t.median,
                            t.latency,
                            t.agreement,
                          ].map((heading) => (
                            <th key={heading} scope="col">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(['fa', 'en', 'all'] as const).map((language) => {
                          const metric = report.comparison.metrics[language];
                          return (
                            <tr key={language}>
                              <th scope="row">{t[language]}</th>
                              <td>{number(metric.caseCount)}</td>
                              <td>
                                {number(metric.baselineMeanHumanScore)} /{' '}
                                {number(metric.candidateMeanHumanScore)} (
                                {number(metric.meanHumanScoreDelta)})
                              </td>
                              <td>{number(metric.regressedCaseCount)}</td>
                              <td>{number(metric.citationErrorDelta)}</td>
                              <td>
                                {number(metric.cost.baseline.completeCostUsd)} /{' '}
                                {number(metric.cost.candidate.completeCostUsd)}
                                <br />
                                <small>
                                  {number(metric.cost.baseline.measuredCaseCount)} /{' '}
                                  {number(metric.cost.candidate.measuredCaseCount)} {t.measured}
                                </small>
                              </td>
                              <td>
                                {number(metric.baselineLatency.p50Ms)} /{' '}
                                {number(metric.candidateLatency.p50Ms)}
                              </td>
                              <td>
                                {number(metric.baselineLatency.p95Ms)} /{' '}
                                {number(metric.candidateLatency.p95Ms)}
                              </td>
                              <td>
                                {number(metric.judgeHumanAgreement.baseline.agreementRate)} /{' '}
                                {number(metric.judgeHumanAgreement.candidate.agreementRate)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
              <button type="button" className="secondary-button" onClick={() => setReports(null)}>
                {t.close}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
