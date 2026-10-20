'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Route } from 'next';
import Link from 'next/link';

import { ApiError, apiGet, apiPost } from '../../api-client';
import { formatDateTime, formatNumber, messagesFor, type Locale } from '../../i18n';
import { FieldLabel, InfoTip, SectionTitle } from '../../info-tip';
import { reportMessagesFor } from '../../report-messages';
import { smartPageContext } from '../../smart/page-context';
import { PagedRows } from '../../table-pager';
import { SignedIn } from '../signed-in';
import { brainMessages, fill } from './brain-messages';
import { Evaluations, type ModelEvaluationSummary, type RoleEvaluationView } from './evaluations';

interface ReportSummary {
  id: string;
  scope: 'project' | 'workspace';
  projectId: string | null;
  createdAt: string;
  totals: { deviations: number; high: number } | null;
}

interface FindingAction {
  key: string;
  kind: string;
  target: { type: string; id: string } | null;
}

interface Finding {
  key: string;
  kind: string;
  severity: 'high' | 'medium' | 'low';
  score: number;
  count: number;
  projectId: string | null;
  params: Record<string, string | number>;
  evidence: { type: string; id: string }[];
  actions: FindingAction[];
}

interface Decision {
  findingKey: string;
  actionKey: string;
  status: 'running' | 'done' | 'failed' | 'dismissed';
}

interface Report extends ReportSummary {
  charterVersion: string;
  deviations: {
    rule: string;
    clause: string;
    role: string;
    severity: string;
    count: number;
    detail: string;
    evidence: { type: string; id: string }[];
  }[];
  recommendations: { rule: string; target: string; action: string }[];
  /** Empty unless the report was generated with the model-based evaluation. */
  evaluations: RoleEvaluationView[];
  summary: { modelEvaluation?: ModelEvaluationSummary };
  findings: Finding[];
  narrative: string | null;
  decisions: Decision[];
}

const EXECUTABLE = new Set(['audit_knowledge', 'request_revision', 'pause_project']);
const SHOWN_EVIDENCE = 5;
const PERIODS = ['7', '30', '90'] as const;

/** Where a link action or a piece of evidence leads; null when it has no page. */
function pageFor(locale: Locale, type: string, id: string | null): Route | null {
  const base = `/${locale}`;
  switch (type) {
    case 'open_knowledge':
    case 'knowledge':
      return id ? (`${base}/knowledge/${id}` as Route) : null;
    case 'open_conflicts':
      return `${base}/knowledge?tab=conflicts` as Route;
    case 'open_project':
    case 'project':
      return id ? (`${base}/projects/${id}` as Route) : null;
    case 'open_costs':
      return `${base}/costs` as Route;
    case 'open_providers':
      return `${base}/providers` as Route;
    case 'open_agent':
      return id ? (`${base}/agents/${id}` as Route) : null;
    default:
      return null;
  }
}

export function BrainReport({ locale }: { locale: Locale }) {
  const text = reportMessagesFor(locale).brain;
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <BrainReports locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

/** The sentence pair (title, body) of a finding, made from its kind and numbers. */
function describe(locale: Locale, finding: Finding) {
  const words = brainMessages(locale);
  const variant = finding.params['variant'];
  const metric = finding.params['metric'];
  const suffix =
    typeof variant === 'string' ? `:${variant}` : typeof metric === 'string' ? `:${metric}` : '';
  const template = words.kinds[`${finding.kind}${suffix}`] ?? words.kinds[finding.kind];
  if (!template) return { title: finding.kind, body: '' };
  const values: Record<string, string | number> = { count: formatNumber(locale, finding.count) };
  for (const [key, value] of Object.entries(finding.params)) {
    values[key] =
      key === 'stage'
        ? (words.stages[String(value)] ?? String(value))
        : typeof value === 'number'
          ? formatNumber(locale, value)
          : value;
  }
  return { title: fill(template.title, values), body: fill(template.body, values) };
}

function BrainReports({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const content = reportMessagesFor(locale);
  const text = content.brain;
  const words = brainMessages(locale);
  const shell = messagesFor(locale);
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [scope, setScope] = useState('');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30');
  const [busy, setBusy] = useState(false);
  const [modelEvaluation, setModelEvaluation] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const detailRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const base = `/workspaces/${workspaceId}/brain-reports`;

  const open = useCallback(
    async (id: string, focus: boolean) => {
      try {
        setSelected((await apiGet<{ report: Report }>(`${base}/${id}`)).report);
        setConfirming(null);
        setActionError('');
        if (focus) setFocusRequest((value) => value + 1);
      } catch {
        setError(content.loadFailed);
      }
    },
    [base, content.loadFailed],
  );

  const load = useCallback(async () => {
    try {
      const list = (await apiGet<{ items: ReportSummary[] }>(base)).items;
      setItems(list);
      const requested = new URLSearchParams(location.search).get('report');
      const first = list.find((item) => item.id === requested) ?? list[0];
      if (first) await open(first.id, false);
    } catch {
      setError(content.loadFailed);
    }
  }, [base, content.loadFailed, open]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiGet<{ items: { id: string; title: string }[] }>(
      `/workspaces/${workspaceId}/projects?limit=100`,
    )
      .then((result) => setProjects(result.items))
      .catch(() => undefined);
  }, [workspaceId]);

  // Tell the Smart assistant which report is open so it can read it for its answers.
  const openId = selected?.id ?? null;
  useEffect(() => {
    smartPageContext.setBrainReport(openId);
  }, [openId]);
  useEffect(() => () => smartPageContext.setBrainReport(null), []);

  // Move focus to the opened report once it has rendered.
  useEffect(() => {
    if (focusRequest > 0) detailRef.current?.focus();
  }, [focusRequest, selected]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiPost(base, {
        modelEvaluation,
        periodDays: Number(period),
        ...(scope ? { projectId: scope } : {}),
      });
      const report = ((await response.json()) as { report: Report }).report;
      setItems((current) => [{ ...report, totals: null }, ...(current ?? [])]);
      setSelected(report);
      setConfirming(null);
      setActionError('');
      setFocusRequest((value) => value + 1);
    } catch {
      setError(shell.errors['generic'] ?? content.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function decide(finding: Finding, action: FindingAction, decision: 'approve' | 'dismiss') {
    if (!selected || acting) return;
    setActing(true);
    setActionError('');
    try {
      await apiPost(`${base}/${selected.id}/actions`, {
        findingKey: finding.key,
        actionKey: action.key,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      setConfirming(null);
      await open(selected.id, false);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : undefined;
      setActionError(words.errors[code ?? ''] ?? words.errors['generic'] ?? '');
      setConfirming(null);
      await open(selected.id, false);
    } finally {
      setActing(false);
    }
  }

  const projectTitle = (id: string | null) =>
    projects.find((project) => project.id === id)?.title ?? words.oneProject;
  const scopeName = (item: { scope: string; projectId: string | null }) =>
    item.scope === 'workspace' ? words.allScope : projectTitle(item.projectId);

  return (
    <div className="stack">
      <form
        className="card filter-form"
        aria-labelledby="brain-run-title"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <h2 id="brain-run-title">{words.run}</h2>
        <p className="muted">{words.intro}</p>
        <div className="filter-grid filters-row">
          <div className="field">
            <FieldLabel htmlFor="brain-scope" help={words.scopeHelp}>
              {words.scope}
            </FieldLabel>
            <select
              id="brain-scope"
              value={scope}
              disabled={busy}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="">{words.scopeAll}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <FieldLabel htmlFor="brain-period" help={words.periodHelp}>
              {words.period}
            </FieldLabel>
            <select
              id="brain-period"
              value={period}
              disabled={busy}
              onChange={(event) => setPeriod(event.target.value as (typeof PERIODS)[number])}
            >
              {PERIODS.map((days) => (
                <option key={days} value={days}>
                  {words.periods[days]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="toolbar">
          <label className="mode">
            <input
              type="checkbox"
              checked={modelEvaluation}
              disabled={busy}
              onChange={(event) => setModelEvaluation(event.target.checked)}
            />{' '}
            {words.modelEvaluation}
          </label>
          <InfoTip text={words.modelEvaluationHelp} />
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? words.running : words.run}
          </button>
          <span className="muted">{words.unchanged}</span>
        </div>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <section className="card" aria-labelledby="reports-title">
          <h2 id="reports-title">{words.history}</h2>
          {items === null ? (
            <p role="status">{content.loading}</p>
          ) : items.length === 0 ? (
            <p className="muted">{words.historyEmpty}</p>
          ) : (
            <ul className="plain-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className="link-like"
                    type="button"
                    aria-pressed={selected?.id === item.id}
                    onClick={() => void open(item.id, true)}
                  >
                    {formatDateTime(locale, item.createdAt)} · {scopeName(item)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected && (
          <section className="card wide" aria-labelledby="report-title">
            <h2 id="report-title" tabIndex={-1} ref={detailRef}>
              {formatDateTime(locale, selected.createdAt)} · {scopeName(selected)}
            </h2>
            {selected.narrative && (
              <div className="notice info">
                <p>
                  <strong>{words.narrative}</strong>{' '}
                  <span className="badge">{words.narrativeBadge}</span>{' '}
                  <InfoTip text={words.narrativeHelp} />
                </p>
                <p>{selected.narrative}</p>
              </div>
            )}
            <SectionTitle as="h3" id="findings-title" help={words.findingsHelp}>
              {words.findings}
            </SectionTitle>
            {actionError && (
              <p className="notice error" role="alert">
                {actionError}
              </p>
            )}
            {selected.findings.length === 0 ? (
              <p>{words.noFindings}</p>
            ) : (
              <ol className="plain-list findings" aria-labelledby="findings-title">
                {selected.findings.map((finding) => {
                  const sentence = describe(locale, finding);
                  return (
                    <li key={finding.key} className="card finding" data-finding={finding.key}>
                      <h4>
                        <span className={`badge severity-${finding.severity}`}>
                          {words.severity[finding.severity]}
                        </span>{' '}
                        {sentence.title}
                        {finding.projectId && selected.scope === 'workspace' && (
                          <small className="muted"> · {projectTitle(finding.projectId)}</small>
                        )}
                      </h4>
                      <p>{sentence.body}</p>
                      <FindingEvidence locale={locale} finding={finding} />
                      <div>
                        <strong>{words.nextSteps}</strong> <InfoTip text={words.nextStepsHelp} />
                      </div>
                      <ul className="plain-list toolbar">
                        {finding.actions.map((action) => (
                          <li key={action.key}>
                            <ActionControl
                              locale={locale}
                              report={selected}
                              finding={finding}
                              action={action}
                              confirming={confirming === `${finding.key}|${action.key}`}
                              acting={acting}
                              note={note}
                              onNote={setNote}
                              onAsk={() => {
                                setConfirming(`${finding.key}|${action.key}`);
                                setNote('');
                              }}
                              onCancel={() => setConfirming(null)}
                              onDecide={(decision) => void decide(finding, action, decision)}
                            />
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            )}
            <details className="card">
              <summary>{words.roleDetails}</summary>
              <p className="muted">{words.roleDetailsHelp}</p>
              <p className="muted">
                {text.charter}: <span dir="ltr">{selected.charterVersion}</span>
              </p>
              <h3>{text.deviations}</h3>
              {selected.deviations.length === 0 ? (
                <p>{text.noDeviations}</p>
              ) : (
                <PagedRows rows={selected.deviations}>
                  {(pageRows) => (
                    <div
                      className="table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label={text.deviations}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">{text.rule}</th>
                            <th scope="col">{text.role}</th>
                            <th scope="col">{text.severity}</th>
                            <th scope="col">{text.count}</th>
                            <th scope="col">{text.detail}</th>
                            <th scope="col">{text.evidence}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((deviation) => (
                            <tr key={`${deviation.rule}-${deviation.role}`}>
                              <td dir="ltr">
                                {deviation.rule}
                                <br />
                                <small>{deviation.clause}</small>
                              </td>
                              <td>{deviation.role}</td>
                              <td>
                                <span className={`badge severity-${deviation.severity}`}>
                                  {deviation.severity}
                                </span>
                              </td>
                              <td>{formatNumber(locale, deviation.count)}</td>
                              <td dir="ltr">{deviation.detail}</td>
                              <td dir="ltr">
                                <ul className="plain-list evidence">
                                  {deviation.evidence.map((item) => (
                                    <li key={item.id}>
                                      {item.type}: <code>{item.id.slice(0, 8)}</code>
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </PagedRows>
              )}
              {(selected.evaluations.length > 0 || selected.summary.modelEvaluation) && (
                <Evaluations
                  locale={locale}
                  evaluations={selected.evaluations}
                  summary={selected.summary.modelEvaluation ?? null}
                />
              )}
              {selected.recommendations.length > 0 && (
                <>
                  <h3>{text.recommendations}</h3>
                  <ul>
                    {selected.recommendations.map((item) => (
                      <li key={`${item.rule}-${item.action}`} dir="ltr">
                        <strong>{item.target}</strong>: {item.action}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          </section>
        )}
      </div>
    </div>
  );
}

/** The records a finding was found from; knowledge and projects open their page. */
function FindingEvidence({ locale, finding }: { locale: Locale; finding: Finding }) {
  const words = brainMessages(locale);
  const shown = finding.evidence.slice(0, SHOWN_EVIDENCE);
  const hidden = finding.evidence.length - shown.length;
  return (
    <div>
      <strong>{words.evidence}</strong> <InfoTip text={words.evidenceHelp} />
      <ul className="plain-list evidence">
        {shown.map((item) => {
          const href = pageFor(locale, item.type, item.id);
          const label = `${words.evidenceTypes[item.type] ?? item.type} ${item.id.slice(0, 8)}`;
          return (
            <li key={`${item.type}-${item.id}`}>
              {href ? <Link href={href}>{label}</Link> : <span>{label}</span>}
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="muted">{fill(words.moreEvidence, { n: formatNumber(locale, hidden) })}</li>
        )}
      </ul>
    </div>
  );
}

/** One proposed next step: a link, or a button that asks before it changes anything. */
function ActionControl({
  locale,
  report,
  finding,
  action,
  confirming,
  acting,
  note,
  onNote,
  onAsk,
  onCancel,
  onDecide,
}: {
  locale: Locale;
  report: Report;
  finding: Finding;
  action: FindingAction;
  confirming: boolean;
  acting: boolean;
  note: string;
  onNote: (value: string) => void;
  onAsk: () => void;
  onCancel: () => void;
  onDecide: (decision: 'approve' | 'dismiss') => void;
}) {
  const words = brainMessages(locale);
  const label = words.actions[action.kind] ?? action.kind;
  if (!EXECUTABLE.has(action.kind)) {
    const href = pageFor(locale, action.kind, action.target?.id ?? null);
    return href ? <Link href={href}>{label}</Link> : <span>{label}</span>;
  }
  const decided = report.decisions.find(
    (item) =>
      item.findingKey === finding.key && item.actionKey === action.key && item.status !== 'failed',
  );
  if (decided) {
    return (
      <span>
        {label}: <span className="badge">{words.decisions[decided.status]}</span>
      </span>
    );
  }
  if (!confirming) {
    return (
      <span className="toolbar compact">
        <button className="secondary-button" type="button" onClick={onAsk} disabled={acting}>
          {label}
        </button>
      </span>
    );
  }
  const textId = `confirm-${finding.key}-${action.key}`.replace(/[^a-zA-Z0-9_-]/gu, '_');
  return (
    <div className="notice warn" role="group" aria-labelledby={textId}>
      <p id={textId}>
        <strong>{label}</strong>: {words.confirmText[action.kind]}
      </p>
      <div className="field">
        <label htmlFor={`${textId}-note`}>{words.noteLabel}</label>
        <input
          id={`${textId}-note`}
          value={note}
          maxLength={1000}
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
      <div className="toolbar">
        <button
          className="primary-button"
          type="button"
          disabled={acting}
          onClick={() => onDecide('approve')}
        >
          {acting ? words.working : words.approve}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={acting}
          onClick={() => onDecide('dismiss')}
        >
          {words.dismiss}
        </button>
        <button className="secondary-button" type="button" disabled={acting} onClick={onCancel}>
          {words.cancel}
        </button>
      </div>
    </div>
  );
}
