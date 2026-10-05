'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { explainError, Notice, useAction } from '../../use-action';
import { editorMessages, fill } from './editor-messages';
import { TermIssues, type TermIssueView } from './term-issues';

interface WritingSummary {
  id: string;
  status: string;
  phase: string;
  level: number;
  templateVersion: string;
  blockCode: string | null;
  errorCode: string | null;
  resultVersionId: string | null;
  withinBounds: boolean | null;
  createdAt: string;
  endedAt: string | null;
}

interface WritingDetail extends WritingSummary {
  notes: string | null;
  flags: string[];
  progress: {
    total: number;
    written: number;
    targetTotal: number | null;
    subsections: {
      id: string;
      section: string;
      heading: string | null;
      target: number;
      letters: number | null;
      state: string;
    }[];
  };
  report: {
    count: number;
    withinBounds: boolean;
    deviation: number;
    fitRounds: number;
    subsections: number;
    modelCalls: number;
    citations: { proposed: number; verified: number; discarded: { ref: string; reason: string }[] };
    references: number;
    discardedBlocks: number;
    notes: string[];
    termIssues?: TermIssueView[];
  } | null;
  cost: { usd: number | null; modelCalls: number };
}

interface TemplateInfo {
  key: string;
  version: string;
  sections: { key: string; label: { fa: string; en: string } }[];
}

const LIVE = ['queued', 'running', 'paused'];
const POLL_MS = 1500;

/**
 * The documenter's writing panel (ADR-0019): starts a durable run that writes the whole
 * document, shows its progress by subsection, lets the administrator pause, resume or cancel,
 * and reports what the run did: length against the level, citations kept and discarded, notes.
 */
export function DocumentWriter({
  locale,
  workspaceId,
  projectId,
  documentId,
  level,
  locked,
  onLive,
  onSaved,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  documentId: string;
  level: number;
  locked: boolean;
  /** Tells the page whether a writing is in progress, so it can close editing meanwhile. */
  onLive: (live: boolean) => void;
  /** A writing finished (success or not): reload the document. */
  onSaved: () => void;
}) {
  const text = editorMessages(locale);
  const base = `/workspaces/${workspaceId}/documents/${documentId}`;
  const [history, setHistory] = useState<WritingSummary[]>([]);
  const [latest, setLatest] = useState<WritingDetail | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState('standard');
  const [chosenLevel, setChosenLevel] = useState(level);
  const [notes, setNotes] = useState('');
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const previous = useRef<string | null>(null);

  const load = useCallback(async () => {
    const list = await apiGet<{ items: WritingSummary[] }>(`${base}/writings`);
    setHistory(list.items);
    const newest = list.items[0];
    if (!newest) {
      setLatest(null);
      return;
    }
    const detail = await apiGet<{ writing: WritingDetail }>(`${base}/writings/${newest.id}`);
    setLatest(detail.writing);
  }, [base]);

  useEffect(() => {
    load().catch(() => setLoadFailed(true));
  }, [load]);

  useEffect(() => {
    apiGet<{ templates: TemplateInfo[] }>(`/workspaces/${workspaceId}/document-templates`)
      .then((result) => setTemplates(result.templates))
      .catch(() => undefined);
    apiGet<{ config: { values: Record<string, unknown> } }>(
      `/workspaces/${workspaceId}/settings/effective?scopeType=project&scopeId=${projectId}`,
    )
      .then((result) => {
        const value = result.config.values['document.default_template'];
        if (typeof value === 'string') setTemplate(value);
      })
      .catch(() => undefined);
  }, [workspaceId, projectId]);

  const live = latest !== null && LIVE.includes(latest.status);
  useEffect(() => onLive(live), [live, onLive]);

  // While a writing is live the panel follows it; when it ends the page reloads the document.
  useEffect(() => {
    if (!live) return undefined;
    const handle = setInterval(() => {
      load().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [live, load]);

  useEffect(() => {
    const status = latest?.status ?? null;
    if (previous.current && LIVE.includes(previous.current) && status && !LIVE.includes(status))
      onSaved();
    previous.current = status;
  }, [latest?.status, onSaved]);

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend('POST', `${base}/writings`, {
        level: chosenLevel,
        template,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setNotes('');
      await load();
    }, '');
  }

  function signal(action: 'pause' | 'resume' | 'cancel', reason?: string) {
    if (!latest) return;
    void run(async () => {
      await apiSend('POST', `${base}/writings/${latest.id}/${action}`, reason ? { reason } : {});
      setCancelReason(null);
      await load();
    }, '');
  }

  const blockedText = (code: string | null): string => {
    if (!code) return '';
    return text.blockCodes[code] ?? fill(text.blockedProvider, { code });
  };

  const selected = templates.find((item) => item.key === template);

  return (
    <section className="card" aria-labelledby="writer-title">
      <h2 id="writer-title">{text.writerTitle}</h2>
      <p className="muted">{text.writerHelp}</p>
      <Notice notice={notice} />
      {loadFailed && (
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      )}

      {!live && !locked && (
        <form className="stack" onSubmit={start} aria-busy={busy}>
          <div className="filter-grid">
            <label htmlFor="writer-level">{text.writerLevel}</label>
            <select
              id="writer-level"
              value={chosenLevel}
              disabled={busy}
              onChange={(event) => setChosenLevel(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {formatNumber(locale, value)}
                </option>
              ))}
            </select>
            <label htmlFor="writer-template">{text.writerTemplate}</label>
            <select
              id="writer-template"
              value={template}
              disabled={busy}
              onChange={(event) => setTemplate(event.target.value)}
            >
              {['brief', 'standard', 'detailed'].map((key) => (
                <option key={key} value={key}>
                  {text.templates[key]}
                </option>
              ))}
            </select>
            <label htmlFor="writer-notes">{text.writerNotes}</label>
            <textarea
              id="writer-notes"
              rows={3}
              maxLength={2000}
              dir="auto"
              value={notes}
              disabled={busy}
              aria-describedby="writer-notes-help"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <p id="writer-notes-help" className="muted">
            {text.writerNotesHelp}
          </p>
          {selected && (
            <p className="muted" dir="auto">
              {selected.sections.map((section) => section.label[locale]).join(' · ')}
            </p>
          )}
          <p className="muted">{text.writeWillReplace}</p>
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? text.writeStarting : text.writeStart}
            </button>
          </div>
        </form>
      )}

      {latest && (
        <div className="stack" aria-live="polite">
          <h3>{text.latestWriting}</h3>
          <p>
            <span className={`badge state-${latest.status}`}>
              {text.writingStatuses[latest.status] ?? latest.status}
            </span>{' '}
            {LIVE.includes(latest.status) && (
              <span className="muted">{text.phases[latest.phase] ?? latest.phase}</span>
            )}
          </p>

          {latest.progress.total > 0 && (
            <div>
              <label htmlFor="writer-progress">
                {fill(text.progress, {
                  done: formatNumber(locale, latest.progress.written),
                  total: formatNumber(locale, latest.progress.total),
                })}
              </label>
              <progress
                id="writer-progress"
                aria-label={text.progressLabel}
                value={latest.progress.written}
                max={latest.progress.total}
              />
              <details>
                <summary>{text.subsections}</summary>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={text.subsections}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{text.subsection}</th>
                        <th scope="col">{text.target}</th>
                        <th scope="col">{text.written}</th>
                        <th scope="col">{text.state}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.progress.subsections.map((item) => (
                        <tr key={item.id}>
                          <th scope="row" dir="auto">
                            {item.heading ?? item.section}
                          </th>
                          <td>{formatNumber(locale, item.target)}</td>
                          <td>
                            {item.letters === null ? '—' : formatNumber(locale, item.letters)}
                          </td>
                          <td>{text.states[item.state] ?? item.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {latest.status === 'paused' && (
            <div className="notice error" role="alert">
              <strong>{text.blockedTitle}</strong>
              <p>{blockedText(latest.blockCode)}</p>
            </div>
          )}

          {LIVE.includes(latest.status) && (
            <div className="toolbar">
              {latest.status === 'paused' ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => signal('resume')}
                >
                  {text.resume}
                </button>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => signal('pause')}
                >
                  {text.pause}
                </button>
              )}
              <button
                className="secondary-button danger"
                type="button"
                disabled={busy}
                aria-expanded={cancelReason !== null}
                onClick={() => setCancelReason(cancelReason === null ? '' : null)}
              >
                {text.cancelWriting}
              </button>
            </div>
          )}
          {cancelReason !== null && LIVE.includes(latest.status) && (
            <div className="card confirm-panel">
              <div className="field-stack">
                <label htmlFor="writer-cancel-reason">{text.cancelReason}</label>
                <input
                  id="writer-cancel-reason"
                  value={cancelReason}
                  maxLength={1000}
                  autoComplete="off"
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </div>
              <div className="toolbar">
                <button
                  className="secondary-button danger"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    signal(
                      'cancel',
                      cancelReason.trim().length >= 3 ? cancelReason.trim() : undefined,
                    )
                  }
                >
                  {text.confirmCancel}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCancelReason(null)}
                >
                  {text.keepWriting}
                </button>
              </div>
            </div>
          )}

          {latest.status === 'failed' && (
            <p className="notice error" role="alert">
              {text.errorCodes[latest.errorCode ?? ''] ??
                fill(text.failedWriting, { code: latest.errorCode ?? '?' })}
            </p>
          )}

          {latest.report && (
            <section aria-labelledby="writer-report-title">
              <h4 id="writer-report-title">{text.report}</h4>
              <dl className="facts">
                <div>
                  <dt>{text.reportCount}</dt>
                  <dd>
                    {formatNumber(locale, latest.report.count)}{' '}
                    <span
                      className={`badge ${latest.report.withinBounds ? 'state-passed' : 'state-failed'}`}
                    >
                      {latest.report.withinBounds ? text.reportWithin : text.reportOutside}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{text.reportSubsections}</dt>
                  <dd>{formatNumber(locale, latest.report.subsections)}</dd>
                </div>
                <div>
                  <dt>{text.reportFit}</dt>
                  <dd>{formatNumber(locale, latest.report.fitRounds)}</dd>
                </div>
                <div>
                  <dt>{text.reportCalls}</dt>
                  <dd>{formatNumber(locale, latest.report.modelCalls)}</dd>
                </div>
                <div>
                  <dt>{text.reportCitations}</dt>
                  <dd>
                    {formatNumber(locale, latest.report.citations.verified)} /{' '}
                    {formatNumber(locale, latest.report.citations.proposed)}
                  </dd>
                </div>
                <div>
                  <dt>{text.reportReferences}</dt>
                  <dd>{formatNumber(locale, latest.report.references)}</dd>
                </div>
                {latest.report.discardedBlocks > 0 && (
                  <div>
                    <dt>{text.reportBlocks}</dt>
                    <dd>{formatNumber(locale, latest.report.discardedBlocks)}</dd>
                  </div>
                )}
                {latest.cost.usd !== null && (
                  <div>
                    <dt>{text.reportCost}</dt>
                    <dd>{formatNumber(locale, Math.round(latest.cost.usd * 10000) / 10000)}</dd>
                  </div>
                )}
              </dl>
              {latest.report.citations.discarded.length > 0 && (
                <>
                  <h5>{text.reportDiscarded}</h5>
                  <ul className="plain-list">
                    {latest.report.citations.discarded.slice(0, 20).map((item, index) => (
                      <li key={`${item.ref}-${index}`}>
                        {item.ref}: {text.discardReasons[item.reason] ?? item.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <TermIssues locale={locale} issues={latest.report.termIssues} level="h5" />
              {latest.report.notes.length > 0 && (
                <>
                  <h5>{text.reportNotes}</h5>
                  <ul className="plain-list">
                    {latest.report.notes.map((note) => (
                      <li key={note}>{text.reportNoteTexts[note] ?? note}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      )}

      <h3>{text.history}</h3>
      {history.length === 0 ? (
        <p className="muted">{text.noHistory}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={text.history}>
          <table>
            <thead>
              <tr>
                <th scope="col">{text.when}</th>
                <th scope="col">{text.writerLevel}</th>
                <th scope="col">{text.writerTemplate}</th>
                <th scope="col">{text.result}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{formatDateTime(locale, item.createdAt)}</th>
                  <td>{formatNumber(locale, item.level)}</td>
                  <td dir="ltr">{item.templateVersion}</td>
                  <td>
                    <span className={`badge state-${item.status}`}>
                      {text.writingStatuses[item.status] ?? item.status}
                    </span>
                    {item.withinBounds === false && (
                      <span className="badge state-failed">{text.reportOutside}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
