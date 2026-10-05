'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPost } from '../../api-client';
import { formatDateTime, formatNumber, messagesFor, type Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { SignedIn } from '../signed-in';
import { Evaluations, type ModelEvaluationSummary, type RoleEvaluationView } from './evaluations';

interface ReportSummary {
  id: string;
  scope: 'project' | 'workspace';
  projectId: string | null;
  createdAt: string;
  totals: { deviations: number; high: number } | null;
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

function BrainReports({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const content = reportMessagesFor(locale);
  const text = content.brain;
  const shell = messagesFor(locale);
  const [items, setItems] = useState<ReportSummary[] | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelEvaluation, setModelEvaluation] = useState(false);
  const [error, setError] = useState('');
  const detailRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const base = `/workspaces/${workspaceId}/brain-reports`;

  const open = useCallback(
    async (id: string, focus: boolean) => {
      try {
        setSelected((await apiGet<{ report: Report }>(`${base}/${id}`)).report);
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

  // Move focus to the opened report once it has rendered.
  useEffect(() => {
    if (focusRequest > 0) detailRef.current?.focus();
  }, [focusRequest, selected]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiPost(base, { modelEvaluation });
      const report = ((await response.json()) as { report: Report }).report;
      setItems((current) => [{ ...report, totals: null }, ...(current ?? [])]);
      setSelected(report);
      setFocusRequest((value) => value + 1);
    } catch {
      setError(shell.errors['generic'] ?? content.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <button
          className="primary-button"
          type="button"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? text.generating : text.generate}
        </button>
        <label className="mode">
          <input
            type="checkbox"
            checked={modelEvaluation}
            disabled={busy}
            onChange={(event) => setModelEvaluation(event.target.checked)}
          />{' '}
          {text.modelEvaluationOption}
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <section className="card" aria-labelledby="reports-title">
          <h2 id="reports-title">{text.reports}</h2>
          {items === null ? (
            <p role="status">{content.loading}</p>
          ) : items.length === 0 ? (
            <p className="muted">{content.dashboard.brainEmpty}</p>
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
                    {formatDateTime(locale, item.createdAt)} ·{' '}
                    {item.scope === 'workspace' ? text.workspaceScope : text.projectScope}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected && (
          <section className="card wide" aria-labelledby="report-title">
            <h2 id="report-title" tabIndex={-1} ref={detailRef}>
              {formatDateTime(locale, selected.createdAt)} ·{' '}
              {selected.scope === 'workspace' ? text.workspaceScope : text.projectScope}
            </h2>
            <p className="notice ok">{text.readOnly}</p>
            <p className="muted">
              {text.charter}: <span dir="ltr">{selected.charterVersion}</span>
            </p>
            <h3>{text.deviations}</h3>
            {selected.deviations.length === 0 ? (
              <p>{text.noDeviations}</p>
            ) : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label={text.deviations}>
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
                    {selected.deviations.map((deviation) => (
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
          </section>
        )}
      </div>
    </div>
  );
}
