'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  intelligenceSearchResultSchema,
  type IntelligenceSearchResult,
  type ProjectResearchPlan,
} from '@docoo/contracts';
import { useReadOnlyAccess } from '../../../resource-access';

type Search = IntelligenceSearchResult;
type Claim = Search['items'][number]['claim'];
type Assessment = {
  status: string;
  coverage: number;
  sourceCount: number;
  freshness: string;
  independence: string;
  applicability: string;
  reasons: string[];
};
type Graph = {
  decisions?: { id: string; version: number }[];
  targets: {
    id: string;
    type: 'solution' | 'document';
    versionId: string;
    blockIndex: number | null;
    title: string;
    text: string;
    assessment: Assessment;
    assertions: { assertion: string; assessment: Assessment }[];
    unavailableLinkCount: number;
  }[];
  claims: Claim[];
  edges: { from: string; to: string; relation: string; assertion?: string }[];
  truncated: boolean;
};
type Suggestion = {
  claimAId: string;
  claimBId: string;
  claimA: Claim;
  claimB: Claim;
  fingerprint: string;
  kind: string;
  reasonCode: string;
  differences: string[];
  review: { decision: string; reason: string; applicability_condition: string | null } | null;
};
type ResearchReport = {
  version: string;
  coverage: number;
  stopReason: string;
  claimVisits: number;
  status: string;
  rounds: { round: number; query: string; newClaimIds: string[] }[];
  questions: { id: string; text: string; covered: boolean; claimIds: string[] }[];
  nextQueries: { questionId: string; query: string }[];
  truncated?: boolean;
};
const terms: Record<string, [string, string]> = {
  insufficient: ['شواهد ناکافی', 'Insufficient evidence'],
  conflicted: ['شواهد متعارض', 'Conflicting evidence'],
  supported_with_limits: ['پشتیبانی با محدودیت', 'Supported with limits'],
  unknown: ['نامعلوم', 'Unknown'],
  reviewed: ['بررسی‌شده', 'Reviewed'],
  coverage_reached: ['پوشش هدف حاصل شد', 'Target coverage reached'],
  round_limit: ['سقف دورها', 'Round limit'],
  visit_budget: ['سقف بررسی ادعاها', 'Claim visit budget'],
  no_new_evidence: ['شاهد تازه پیدا نشد', 'No new evidence'],
  insufficient_evidence: ['شواهد ناکافی', 'Insufficient evidence'],
  supports: ['پشتیبان', 'Supports'],
  opposes: ['مخالف', 'Opposes'],
  context: ['زمینه', 'Context'],
  exact_quote: ['نقل‌قول دقیق', 'Exact quote'],
  contradiction: ['تناقض احتمالی', 'Possible contradiction'],
  temporal: ['تفاوت زمانی', 'Temporal difference'],
  scope: ['تفاوت دامنه', 'Scope difference'],
  methodology: ['تفاوت روش یا برآورد', 'Method or estimate difference'],
  opposite_direction: ['جهت اثر مخالف', 'Opposite effect direction'],
  negated_assertion: ['وجود نفی', 'Negated assertion'],
  different_estimate: ['برآورد متفاوت', 'Different estimate'],
  date: ['تاریخ', 'Date'],
  population: ['جامعه', 'Population'],
  method: ['روش', 'Method'],
  quantity: ['مقدار', 'Quantity'],
  confirmed: ['تأیید تعارض', 'Confirmed'],
  dismissed: ['رد پیشنهاد', 'Dismissed'],
  conditioned: ['تأیید مشروط', 'Conditional'],
  no_adequate_support: ['پشتیبان کافی ثبت نشده', 'No adequate support'],
  quantified_assertion_not_supported: [
    'اعداد ادعا پشتیبان کافی ندارند',
    'Numbers lack adequate support',
  ],
  opposing_evidence: ['شاهد مخالف وجود دارد', 'Opposing evidence'],
  applicability_not_reviewed: ['کاربرد در این تصمیم بررسی نشده', 'Applicability not reviewed'],
  source_independence_unknown: ['استقلال منابع نامعلوم است', 'Source independence unknown'],
  freshness_unknown: ['تازگی شواهد نامعلوم است', 'Freshness unknown'],
};

export function ProjectIntelligenceScreen({
  locale,
  projectId,
  workspaceId,
}: {
  locale: 'fa' | 'en';
  projectId: string;
  workspaceId: string;
}) {
  const fa = locale === 'fa';
  const readonly = useReadOnlyAccess();
  const t = (persian: string, english: string) => (fa ? persian : english);
  const label = (key: string) => terms[key]?.[fa ? 0 : 1] ?? key;
  const base = `/api/workspaces/${workspaceId}/projects/${projectId}`;
  const [graph, setGraph] = useState<Graph | null>(null);
  const [conflicts, setConflicts] = useState<Suggestion[]>([]);
  const [reports, setReports] = useState<
    { workflowRunId: string; report: ResearchReport | null; current: boolean; status: string }[]
  >([]);
  const [search, setSearch] = useState<Search | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'hybrid' | 'lexical'>('hybrid');
  const [language, setLanguage] = useState<'both' | 'fa' | 'en'>('both');
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [targetId, setTargetId] = useState('');
  const [assertion, setAssertion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const researchAttempt = useRef<{ plan: string; key: string } | null>(null);
  const [preview, setPreview] = useState<ResearchReport | null>(null);

  const request = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<T>;
    },
    [base],
  );
  const reload = useCallback(async () => {
    const [g, c, r] = await Promise.all([
      request<Graph>('/intelligence/graph'),
      request<{ items: Suggestion[] }>('/intelligence/conflicts'),
      request<{
        items: {
          workflowRunId: string;
          report: ResearchReport | null;
          current: boolean;
          status: string;
        }[];
      }>('/intelligence/research/reports'),
    ]);
    setGraph(g);
    setConflicts(c.items);
    setReports(r.items);
  }, [request]);
  useEffect(() => {
    let active = true;
    void reload().catch(() => {
      if (active)
        setError(
          fa
            ? 'بارگذاری انجام نشد؛ ورود و دسترسی پروژه را بررسی کنید.'
            : 'Loading failed. Check sign-in and project access.',
        );
    });
    return () => {
      active = false;
    };
  }, [reload, fa]);
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch {
      setError(
        t(
          'عملیات انجام نشد. دسترسی و اعتبار شواهد را بررسی کنید و تازه‌سازی کنید.',
          'Operation failed. Check access and evidence validity, then refresh.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  function assessment(a: Assessment) {
    return (
      <div className="intelligence-assessment">
        <strong>{label(a.status)}</strong>
        <p>
          {t('پوشش واژگانی/مفهومی', 'Term/concept coverage')}: {a.coverage}% ·{' '}
          {t('نسخه‌های منبع', 'Source versions')}: {a.sourceCount}
        </p>
        <p>
          {t('تازگی', 'Freshness')}: {label(a.freshness)} · {t('استقلال', 'Independence')}:{' '}
          {label(a.independence)} · {t('کاربرد', 'Applicability')}: {label(a.applicability)}
        </p>
        <ul>
          {a.reasons.map((r) => (
            <li key={r}>{label(r)}</li>
          ))}
        </ul>
      </div>
    );
  }
  function citation(claim: Claim) {
    return (
      <details>
        <summary>
          {t('متن و ارجاع دقیق', 'Text and exact citation')} · {claim.title}
        </summary>
        <p>{claim.text}</p>
        <blockquote>{claim.quote}</blockquote>
        <p>
          {t('نسخهٔ دانش / منبع', 'Knowledge / source version')}:{' '}
          <code>{claim.knowledgeVersionId}</code> / <code>{claim.sourceVersionId}</code>
        </p>
        <p>
          {t('بازهٔ متن UTF-16', 'UTF-16 text range')}: {claim.startOffset}–{claim.endOffset} ·
          SHA-256: <code>{claim.quoteHash}</code>
        </p>
        {claim.finalUrl && (
          <a href={claim.finalUrl} target="_blank" rel="noopener noreferrer">
            {t('منبع اصلی', 'Original source')}
          </a>
        )}
      </details>
    );
  }
  function researchReport(report: ResearchReport) {
    return (
      <div>
        <strong>{label(report.status)}</strong>
        <p>
          {t('پوشش تطبیقی', 'Adaptive coverage')}: {report.coverage}% ·{' '}
          {t('علت توقف', 'Stop reason')}: {label(report.stopReason)} ·{' '}
          {t('ادعاهای بررسی‌شده', 'Claim visits')}: {report.claimVisits}
        </p>
        <ol>
          {report.rounds.map((round) => (
            <li key={round.round}>
              {round.query} · {round.newClaimIds.length} {t('شاهد تازه', 'new evidence')}
            </li>
          ))}
        </ol>
        <ul>
          {report.questions
            .filter((q) => !q.covered)
            .map((q) => (
              <li key={q.id}>
                {t('پرسش بی‌پاسخ', 'Uncovered question')}: {q.text}
              </li>
            ))}
        </ul>
        {report.truncated && (
          <p>
            {t(
              'مجموعهٔ نامزدها به سقف رسید؛ نتیجه ممکن است کامل نباشد.',
              'Candidate limit reached; results may be incomplete.',
            )}
          </p>
        )}
      </div>
    );
  }
  function buildPlan(form: FormData): ProjectResearchPlan {
    const questions = String((form.get('questions') as string | null) ?? '')
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text, i) => ({ id: `q${i + 1}`, text, importance: 3 }));
    return {
      version: 1,
      query: questions[0]?.text ?? '',
      language: locale,
      sourceLanguages: language === 'both' ? ['fa', 'en'] : [language],
      knowledgeSourceTypes: ['admin', 'clue_research', 'autonomous_research'],
      country: null,
      timeRange: { from: null, to: null },
      sourcePolicy: { mode: 'unrestricted', domains: [] },
      targetCount: 50,
      similarSampleCount: 0,
      depth: 'deep',
      adaptive: {
        questions,
        maxRounds: Number(form.get('maxRounds')),
        maxClaimVisits: Number(form.get('maxVisits')),
        targetCoverage: Number(form.get('targetCoverage')),
        perQuestionLimit: 5,
      },
    };
  }
  async function submitResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement) form.set('action', submitter.value);
    const plan = buildPlan(form);
    const launch = form.get('action') === 'launch';
    await perform(async () => {
      if (launch) {
        const encoded = JSON.stringify(plan);
        if (researchAttempt.current?.plan !== encoded)
          researchAttempt.current = { plan: encoded, key: crypto.randomUUID() };
        await request('/intelligence/research/runs', {
          plan,
          idempotencyKey: researchAttempt.current.key,
        });
        researchAttempt.current = null;
        await reload();
        setNotice(
          t(
            'پژوهش در صف قرار گرفت؛ گزارش را با تازه‌سازی ببینید.',
            'Research queued. Refresh to read the report.',
          ),
        );
      } else setPreview(await request<ResearchReport>('/intelligence/research/preview', plan));
    });
  }

  return (
    <div className="page-shell intelligence-page" dir={fa ? 'rtl' : 'ltr'}>
      <header className="page-header">
        <div>
          <h2>{t('شواهد و تصمیم پروژه', 'Project evidence and decisions')}</h2>
          <p>
            {t(
              'جست‌وجو، پژوهش تطبیقی، تعارض‌ها و کفایت شواهد در یک مسیر.',
              'Search, adaptive research, conflicts and evidence sufficiency.',
            )}
          </p>
        </div>
        <Link
          className="secondary-button"
          href={`/${locale}/projects/${projectId}?tab=knowledge` as Route}
        >
          {t('منابع پروژه', 'Project sources')}
        </Link>
        <button className="secondary-button" disabled={busy} onClick={() => void perform(reload)}>
          {t('تازه‌سازی', 'Refresh')}
        </button>
      </header>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="panel">
        <h2>{t('جست‌وجوی شواهد مجاز', 'Search approved evidence')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              setSearch(
                intelligenceSearchResultSchema.parse(
                  await request('/intelligence/search', {
                    query,
                    mode,
                    languages: language === 'both' ? ['fa', 'en'] : [language],
                    limit: 20,
                  }),
                ),
              );
            });
          }}
        >
          <label>
            {t('پرسش یا عبارت', 'Question or query')}
            <input
              required
              minLength={2}
              maxLength={500}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            {t('روش جست‌وجو', 'Search method')}
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="hybrid">{t('ترکیبی با بازرتبه‌بندی', 'Hybrid with reranking')}</option>
              <option value="lexical">{t('خط مبنای متنی', 'Full-text baseline')}</option>
            </select>
          </label>
          <label>
            {t('زبان منابع', 'Source languages')}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
            >
              <option value="both">{t('فارسی و انگلیسی', 'Persian and English')}</option>
              <option value="fa">{t('فقط فارسی', 'Persian only')}</option>
              <option value="en">{t('فقط انگلیسی', 'English only')}</option>
            </select>
          </label>
          <button disabled={busy}>{t('جست‌وجو', 'Search')}</button>
        </form>
        {search && (
          <>
            <p>
              {search.items.length} {t('نتیجه', 'results')} ·{' '}
              {search.embeddingStatus === 'provider'
                ? t('مدل معنایی', 'Semantic model')
                : t('نمایهٔ مفهومی محلی', 'Local concept projection')}
              : {search.model}
            </p>
            {search.truncated && (
              <p>{t('سقف نامزدها اعمال شده است.', 'Candidate limit applied.')}</p>
            )}
            {search.fallbackReason && (
              <p>
                {t(
                  'مدل بیرونی در دسترس نبود؛ مسیر محلی استفاده شد.',
                  'External model unavailable; local retrieval used.',
                )}
              </p>
            )}
            {search.items.map((row) => (
              <article key={row.claim.id} className="intelligence-card">
                {citation(row.claim)}
                <p>
                  {t('امتیاز متنی', 'Text score')}: {row.lexicalScore.toFixed(3)} ·{' '}
                  {t('شباهت برداری', 'Vector similarity')}: {row.semanticScore.toFixed(3)}
                </p>
                {!readonly && (
                  <button className="secondary-button" onClick={() => setSelectedClaim(row.claim)}>
                    {t('انتخاب برای اتصال به تصمیم', 'Choose for decision link')}
                  </button>
                )}
              </article>
            ))}
          </>
        )}
      </section>
      <section className="panel">
        <h2>
          {t('گراف شواهد تا تصمیم و کفایت شواهد', 'Evidence-to-decision graph and sufficiency')}
        </h2>
        <p>
          {t(
            'پوشش، شاخص تطبیق متن است و احتمال صحت نیست. استقلال منبع بدون بررسی انسانی نامعلوم می‌ماند.',
            'Coverage measures text matching, not probability of truth. Source independence remains unknown without human review.',
          )}
        </p>
        {!graph && <p>{t('در حال دریافت…', 'Loading…')}</p>}
        {graph?.targets.length === 0 && (
          <p>
            {t(
              'با ایجاد راهکار یا سند، مقصدهای قابل اتصال اینجا ظاهر می‌شوند.',
              'Create a solution or document to see evidence targets here.',
            )}
          </p>
        )}
        {graph?.targets.map((target) => (
          <article className="intelligence-card" key={target.id}>
            <h3>
              {target.title} ·{' '}
              {target.type === 'document'
                ? `${t('بلوک', 'Block')} ${target.blockIndex}`
                : t('راهکار', 'Solution')}
            </h3>
            <p>{target.text}</p>
            {graph.edges
              .filter((edge) => edge.from === target.id && edge.relation === 'selected_for')
              .map((edge) => (
                <p key={edge.to}>
                  {t('در انتخاب ثبت‌شدهٔ راهکارها', 'Included in saved solution selection')} · v
                  {graph.decisions?.find((d) => d.id === edge.to)?.version}
                </p>
              ))}
            {assessment(target.assessment)}
            <details>
              <summary>{t('مسیرهای استناد', 'Citation paths')}</summary>
              {graph.edges
                .filter((edge) => edge.to === target.id)
                .map((edge, i) => {
                  const claim = graph.claims.find((c) => `claim:${c.id}` === edge.from);
                  return (
                    claim && (
                      <div key={`${edge.from}:${i}`} className="intelligence-path">
                        <p>
                          {t('نسخهٔ منبع ← ادعا ← تصمیم', 'Source version → claim → decision')} ·{' '}
                          {label(edge.relation)}
                        </p>
                        {edge.assertion && <p>{edge.assertion}</p>}
                        {citation(claim)}
                      </div>
                    )
                  );
                })}
              {target.assertions.map((a) => (
                <div key={a.assertion}>
                  <p>{a.assertion}</p>
                  {assessment(a.assessment)}
                </div>
              ))}
            </details>
            {target.unavailableLinkCount > 0 && (
              <p>
                {t(
                  'بعضی اتصال‌ها به دلیل دسترسی یا اعتبار فعلی قابل استفاده نیستند.',
                  'Some links are unavailable under current access or review status.',
                )}
              </p>
            )}
          </article>
        ))}
        {!readonly && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void perform(async () => {
                const target = graph?.targets.find((item) => item.id === targetId);
                if (!target || !selectedClaim) throw new Error();
                await request('/intelligence/evidence-links', {
                  targetType: target.type,
                  targetVersionId: target.versionId,
                  blockIndex: target.blockIndex,
                  assertion,
                  claimId: selectedClaim.id,
                  relation: data.get('relation'),
                  applicabilityReviewed: data.get('applicable') === 'on',
                  reason: data.get('reason'),
                  idempotencyKey: crypto.randomUUID(),
                });
                await reload();
                setNotice(t('اتصال شواهد ثبت شد.', 'Evidence link recorded.'));
              });
            }}
          >
            <h3>{t('اتصال شاهد به گزارهٔ تصمیم', 'Link evidence to a decision assertion')}</h3>
            <p>
              {selectedClaim
                ? selectedClaim.text
                : t(
                    'ابتدا شاهد را از نتایج جست‌وجو انتخاب کنید.',
                    'Choose a claim from search results first.',
                  )}
            </p>
            <label>
              {t('مقصد', 'Target')}
              <select
                required
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setAssertion(
                    graph?.targets
                      .find((target) => target.id === e.target.value)
                      ?.text.slice(0, 2000) ?? '',
                  );
                }}
              >
                <option value="">{t('انتخاب کنید', 'Choose')}</option>
                {graph?.targets.map((target) => (
                  <option value={target.id} key={target.id}>
                    {target.title} · {target.type} {target.blockIndex}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t(
                'گزاره؛ باید عیناً در متن مقصد باشد',
                'Assertion; must occur verbatim in target text',
              )}
              <textarea
                required
                minLength={2}
                maxLength={2000}
                value={assertion}
                onChange={(e) => setAssertion(e.target.value)}
              />
            </label>
            <label>
              {t('نوع اتصال', 'Relation')}
              <select name="relation">
                <option value="supports">{label('supports')}</option>
                <option value="opposes">{label('opposes')}</option>
                <option value="context">{label('context')}</option>
              </select>
            </label>
            <label>
              <input type="checkbox" name="applicable" />
              {t(
                'کاربرد این شاهد در تصمیم را بررسی کردم',
                'I reviewed applicability to this decision',
              )}
            </label>
            <label>
              {t('دلیل', 'Reason')}
              <textarea name="reason" required minLength={3} maxLength={1000} />
            </label>
            <button disabled={busy || !selectedClaim}>{t('ثبت اتصال', 'Record link')}</button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>{t('پیشنهادهای تعارض', 'Conflict suggestions')}</h2>
        <p>
          {t(
            'پیشنهادهای خودکار نیازمند بررسی‌اند. تفاوت جامعه یا روش می‌تواند دو نتیجه را هم‌زمان معتبر کند.',
            'Automatic suggestions require review. Population or method differences can make both findings applicable.',
          )}
        </p>
        {conflicts.length === 0 && (
          <p>
            {t(
              'در مجموعهٔ بررسی‌شده پیشنهادی پیدا نشد.',
              'No suggestions found in the examined candidates.',
            )}
          </p>
        )}
        {conflicts.map((c) => (
          <article className="intelligence-card" key={c.fingerprint}>
            <h3>{label(c.kind)}</h3>
            <p>
              {label(c.reasonCode)} · {c.differences.map(label).join(' · ')}
            </p>
            {citation(c.claimA)}
            {citation(c.claimB)}
            {c.review && (
              <p>
                {label(c.review.decision)}: {c.review.reason} {c.review.applicability_condition}
              </p>
            )}
            {!readonly && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void perform(async () => {
                    await request('/intelligence/conflicts/reviews', {
                      claimAId: c.claimAId,
                      claimBId: c.claimBId,
                      expectedFingerprint: c.fingerprint,
                      decision: data.get('decision'),
                      applicabilityCondition:
                        String((data.get('condition') as string | null) ?? '').trim() || null,
                      reason: data.get('reason'),
                      idempotencyKey: crypto.randomUUID(),
                    });
                    await reload();
                  });
                }}
              >
                <label>
                  {t('تصمیم', 'Decision')}
                  <select name="decision">
                    <option value="confirmed">{label('confirmed')}</option>
                    <option value="dismissed">{label('dismissed')}</option>
                    <option value="conditioned">{label('conditioned')}</option>
                  </select>
                </label>
                <label>
                  {t(
                    'شرط کاربرد؛ برای تصمیم مشروط الزامی است',
                    'Applicability condition; required for conditional review',
                  )}
                  <textarea name="condition" maxLength={2000} />
                </label>
                <label>
                  {t('دلیل تصمیم', 'Decision reason')}
                  <textarea name="reason" required minLength={3} maxLength={1000} />
                </label>
                <button disabled={busy}>{t('ثبت بررسی انسانی', 'Record human review')}</button>
              </form>
            )}
          </article>
        ))}
        <Link href={`/${locale}/knowledge` as Route}>
          {t('تاریخچه و حل تعارض‌ها', 'Conflict history and resolution')}
        </Link>
      </section>
      <section className="panel">
        <h2>{t('پژوهش تطبیقی', 'Adaptive research')}</h2>
        <p>
          {t(
            'هر خط یک پرسش است. موتور از دانش تأییدشدهٔ داخلی جست‌وجو می‌کند و با رسیدن به پوشش هدف یا سقف منابع متوقف می‌شود. نتیجهٔ پوشش معیار احتمال حقیقت نیست.',
            'One question per line. Searches approved internal knowledge and stops at target coverage or resource limits. Coverage is not a probability of truth.',
          )}
        </p>
        <form onSubmit={(e) => void submitResearch(e)}>
          <label>
            {t('پرسش‌ها؛ حداکثر ۲۰', 'Questions; maximum 20')}
            <textarea required name="questions" maxLength={10000} />
          </label>
          <label>
            {t('سقف دورها', 'Maximum rounds')}
            <input type="number" name="maxRounds" defaultValue={10} min={1} max={20} required />
          </label>
          <label>
            {t('بودجهٔ بررسی ادعا؛ حداکثر خروجی ۵۰', 'Claim visit budget; output capped at 50')}
            <input type="number" name="maxVisits" defaultValue={40} min={1} max={400} required />
          </label>
          <label>
            {t('پوشش هدف درصد', 'Target coverage percent')}
            <input
              type="number"
              name="targetCoverage"
              defaultValue={80}
              min={1}
              max={100}
              required
            />
          </label>
          <button name="action" value="preview" disabled={busy}>
            {t('پیش‌نمایش پوشش', 'Preview coverage')}
          </button>
          {!readonly && (
            <button name="action" value="launch" disabled={busy}>
              {t('اجرای پژوهش پایدار', 'Run durable research')}
            </button>
          )}
        </form>
        {preview && researchReport(preview)}
        <h3>{t('گزارش‌های ذخیره‌شده', 'Saved reports')}</h3>
        {reports.map((item) => (
          <article className="intelligence-card" key={item.workflowRunId}>
            <code>{item.workflowRunId}</code>
            {item.status === 'queued' ? (
              <p role="status">
                {t('پژوهش در صف پردازش است.', 'Research is queued for processing.')}
              </p>
            ) : item.status === 'failed' ? (
              <p role="alert">
                {t('پژوهش انجام نشد؛ اجرای تازه ثبت کنید.', 'Research failed; start a new run.')}
              </p>
            ) : item.current && item.report ? (
              researchReport(item.report)
            ) : (
              <p>
                {t(
                  'اعتبار شواهد تغییر کرده؛ گزارش قبلی قابل استفاده نیست.',
                  'Evidence validity changed; the old report is unavailable.',
                )}
              </p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
