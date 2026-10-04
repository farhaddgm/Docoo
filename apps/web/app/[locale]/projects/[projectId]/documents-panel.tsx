'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend, query } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { DocumentContent, type DocContent } from './document-content';
import { documentMessages } from './document-messages';

interface DocumentSummary {
  id: string;
  priority: number;
  title: string;
  level: number;
  language: 'fa' | 'en';
  status: string;
  approvalKind: string | null;
  updatedAt: string;
}

interface VersionSummary {
  id: string;
  versionNo: number;
  charCount: number;
  level: number;
  bounds: { min: number; max: number };
  withinBounds: boolean;
  origin: string;
  reason: string | null;
  createdAt: string;
}

interface Evaluation {
  id: string;
  status: string;
  overall: number;
  scores: { criterion: string; score: number; evidence: string }[];
  rubric: { criteria: { key: string; label: string }[] };
  findings: {
    id: string;
    severity: string;
    criterion: string;
    evidence: string;
    location: string;
    targetStage: string | null;
    defaultTargetStage: string | null;
  }[];
  exception: { reason: string; badge: string } | null;
}

interface DocumentDetail extends DocumentSummary {
  currentVersion: (VersionSummary & { content: DocContent }) | null;
  latestEvaluation: Evaluation | null;
}

interface Artifact {
  id: string;
  format: string;
  documentVersion: number;
  sizeBytes: number;
  createdAt: string;
}

interface Diff {
  from: number;
  to: number;
  titleChanged: boolean;
  changes: { id: string; change: string; type: string }[];
  summary: { added: number; removed: number; changed: number; moved: number };
}

type Pending =
  | { kind: 'reject' | 'lock' | 'supersede' | 'exception'; reason: string }
  | { kind: 'restore'; versionId: string; versionNo: number; reason: string };

const formats = ['docx', 'pdf', 'pptx'] as const;

/** DOC-101..103, EVA-001..002: documents of the project, their review, evaluation and exports. */
export function DocumentsPanel({
  locale,
  workspaceId,
  projectId,
  refreshKey,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  refreshKey: number;
}) {
  const text = documentMessages(locale);
  const common = reportMessagesFor(locale);
  const [items, setItems] = useState<DocumentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { items: loaded } = await apiGet<{ items: DocumentSummary[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/documents`,
    );
    setItems(loaded);
  }, [workspaceId, projectId]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load, refreshKey]);

  if (openId) {
    return (
      <DocumentView
        key={openId}
        locale={locale}
        workspaceId={workspaceId}
        documentId={openId}
        onBack={() => {
          setOpenId(null);
          void load().catch(() => setFailed(true));
        }}
      />
    );
  }

  return (
    <section className="card" aria-labelledby="documents-title">
      <h2 id="documents-title">{text.listTitle}</h2>
      {failed ? (
        <p className="notice error" role="alert">
          {common.loadFailed}
        </p>
      ) : items === null ? (
        <p role="status">{common.loading}</p>
      ) : items.length === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="documents-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{text.priority}</th>
                <th scope="col">{text.docTitle}</th>
                <th scope="col">{text.level}</th>
                <th scope="col">{text.status}</th>
                <th scope="col">{text.updated}</th>
                <th scope="col">
                  <span className="visually-hidden">{text.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatNumber(locale, item.priority)}</td>
                  <th scope="row" dir="auto">
                    {item.title}
                  </th>
                  <td>{formatNumber(locale, item.level)}</td>
                  <td>
                    <span className={`badge state-${item.status}`}>
                      {text.statuses[item.status] ?? item.status}
                    </span>
                    {item.approvalKind === 'accepted_with_exception' && (
                      <span className="badge state-paused">{text.exceptionBadge}</span>
                    )}
                  </td>
                  <td>{formatDateTime(locale, item.updatedAt)}</td>
                  <td>
                    <button
                      className="secondary-button"
                      type="button"
                      aria-label={`${text.open}: ${item.title}`}
                      onClick={() => setOpenId(item.id)}
                    >
                      {text.open}
                    </button>
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

function DocumentView({
  locale,
  workspaceId,
  documentId,
  onBack,
}: {
  locale: Locale;
  workspaceId: string;
  documentId: string;
  onBack: () => void;
}) {
  const text = documentMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/documents/${documentId}`;
  const [doc, setDocument] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [diff, setDiff] = useState<Diff | null>(null);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    const [detail, history, files] = await Promise.all([
      apiGet<{ document: DocumentDetail }>(base),
      apiGet<{ items: VersionSummary[] }>(`${base}/versions`),
      apiGet<{ items: Artifact[] }>(`${base}/artifacts`),
    ]);
    setDocument(detail.document);
    setVersions(history.items);
    setArtifacts(files.items);
    const [latest, previous] = history.items;
    setDiffTo(latest?.id ?? '');
    setDiffFrom(previous?.id ?? latest?.id ?? '');
    setDiff(null);
  }, [base]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  if (failed && !doc) {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (!doc) return <p role="status">{common.loading}</p>;

  const current = doc.currentVersion;
  const evaluation = doc.latestEvaluation;
  const status = doc.status;
  const labelOf = (key: string) =>
    evaluation?.rubric.criteria.find((criterion) => criterion.key === key)?.label ?? key;
  const reasonText = (value: string) => value.trim();

  function simple(path: string, body: unknown, done: string) {
    void run(async () => {
      await apiSend('POST', `${base}/${path}`, body);
      setPending(null);
      await load();
    }, done);
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const reason = reasonText(pending.reason);
    if (pending.kind === 'exception') {
      void run(async () => {
        await apiSend(
          'POST',
          `/workspaces/${workspaceId}/evaluations/${evaluation?.id}/accept-exception`,
          {
            reason,
          },
        );
        setPending(null);
        await load();
      }, text.done['exception']!);
    } else if (pending.kind === 'restore') {
      simple(`versions/${pending.versionId}/restore`, { reason }, text.done['restore']!);
    } else if (pending.kind === 'lock') {
      simple('lock', reason ? { reason } : {}, text.done['lock']!);
    } else {
      simple(pending.kind, { reason }, text.done[pending.kind]!);
    }
  }

  function showDiff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await apiGet<{ diff: Diff }>(
        `${base}/diff${query({ from: diffFrom, to: diffTo })}`,
      );
      setDiff(result.diff);
    }, '');
  }

  const requiresReason = pending?.kind !== 'lock';
  const canExport = !!current;
  const failedEvaluation =
    evaluation !== null &&
    !evaluation.exception &&
    ['failed_quality', 'failed_compliance', 'needs_human_decision'].includes(evaluation.status);

  return (
    <div className="stack">
      <p>
        <button className="link-like" type="button" onClick={onBack}>
          {text.back}
        </button>
      </p>
      <Notice notice={notice} />

      <section className="card" aria-labelledby="document-heading">
        <h2 id="document-heading" dir="auto">
          {doc.title}
        </h2>
        <dl className="facts">
          <div>
            <dt>{text.status}</dt>
            <dd>
              <span className={`badge state-${status}`}>{text.statuses[status] ?? status}</span>
              {doc.approvalKind === 'accepted_with_exception' && (
                <span className="badge state-paused">{text.exceptionBadge}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{text.level}</dt>
            <dd>{formatNumber(locale, doc.level)}</dd>
          </div>
          {current && (
            <>
              <div>
                <dt>{text.version.replace('{n}', formatNumber(locale, current.versionNo))}</dt>
                <dd>
                  {text.characters}: {formatNumber(locale, current.charCount)}
                </dd>
              </div>
              <div>
                <dt>
                  {text.bounds
                    .replace('{level}', formatNumber(locale, current.level))
                    .replace('{min}', formatNumber(locale, current.bounds.min))
                    .replace('{max}', formatNumber(locale, current.bounds.max))}
                </dt>
                <dd>
                  <span
                    className={`badge ${current.withinBounds ? 'state-passed' : 'state-failed'}`}
                  >
                    {current.withinBounds ? text.inBounds : text.outOfBounds}
                  </span>
                </dd>
              </div>
            </>
          )}
          {doc.approvalKind && (
            <div>
              <dt>{text.approvedWith}</dt>
              <dd>{text.approvalKinds[doc.approvalKind] ?? doc.approvalKind}</dd>
            </div>
          )}
        </dl>

        <h3>{text.actions}</h3>
        <div className="toolbar" role="group" aria-label={text.actions}>
          {['draft', 'non_compliant', 'rejected'].includes(status) && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => simple('submit', {}, text.done['submit']!)}
            >
              {text.submit}
            </button>
          )}
          {!['locked', 'superseded'].includes(status) && current && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await apiSend('POST', `${base}/evaluate`);
                  await load();
                }, text.done['evaluate']!)
              }
            >
              {busy ? text.evaluating : text.evaluate}
            </button>
          )}
          {status === 'ready_for_review' && (
            <>
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => simple('approve', {}, text.done['approve']!)}
              >
                {text.approve}
              </button>
              <button
                className="secondary-button danger"
                type="button"
                disabled={busy}
                aria-expanded={pending?.kind === 'reject'}
                onClick={() => setPending({ kind: 'reject', reason: '' })}
              >
                {text.reject}
              </button>
            </>
          )}
          {status === 'approved' && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              aria-expanded={pending?.kind === 'lock'}
              onClick={() => setPending({ kind: 'lock', reason: '' })}
            >
              {text.lock}
            </button>
          )}
          {status === 'locked' && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              aria-expanded={pending?.kind === 'supersede'}
              onClick={() => setPending({ kind: 'supersede', reason: '' })}
            >
              {text.supersede}
            </button>
          )}
        </div>

        {pending && (
          <form className="card confirm-panel filter-form" onSubmit={confirm} aria-busy={busy}>
            <p>
              {pending.kind === 'exception'
                ? text.exceptionHelp
                : pending.kind === 'restore'
                  ? text.restoreReason
                  : (text.effects[pending.kind] ?? '')}
            </p>
            <div className="filter-grid">
              <label htmlFor="document-reason">
                {requiresReason ? text.reasonRequired : text.reasonOptional}
              </label>
              <input
                id="document-reason"
                value={pending.reason}
                minLength={3}
                maxLength={1000}
                onChange={(event) => setPending({ ...pending, reason: event.target.value })}
                required={requiresReason}
                autoComplete="off"
              />
            </div>
            <div className="toolbar">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? text.working : text.confirm}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                {text.cancel}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="content-title">
        <h2 id="content-title">{text.content}</h2>
        {current ? (
          <DocumentContent locale={locale} content={current.content} />
        ) : (
          <p className="muted">{text.noContent}</p>
        )}
      </section>

      <section className="card" aria-labelledby="evaluation-title">
        <h2 id="evaluation-title">{text.evaluation}</h2>
        {!evaluation ? (
          <p className="muted">{text.evaluationNone}</p>
        ) : (
          <>
            <p>
              <span className={`badge state-${evaluation.status}`}>
                {text.evaluationStatuses[evaluation.status] ?? evaluation.status}
              </span>{' '}
              {text.overall}: <strong>{formatNumber(locale, evaluation.overall)}</strong>
              {evaluation.exception && (
                <>
                  {' '}
                  <span className="badge state-paused">{text.exceptionBadge}</span>
                </>
              )}
            </p>
            {evaluation.exception && (
              <p className="muted">
                {text.exceptionBy}: <span dir="auto">{evaluation.exception.reason}</span>
              </p>
            )}
            {evaluation.scores.length > 0 && (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-labelledby="evaluation-title"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{text.criterion}</th>
                      <th scope="col">{text.score}</th>
                      <th scope="col">{text.evidence}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluation.scores.map((row) => (
                      <tr key={row.criterion}>
                        <th scope="row" dir="auto">
                          {labelOf(row.criterion)}
                        </th>
                        <td>{formatNumber(locale, row.score)}</td>
                        <td dir="auto">{row.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3>{text.findings}</h3>
            {evaluation.findings.length === 0 ? (
              <p className="muted">{text.findingsNone}</p>
            ) : (
              <ul className="plain-list">
                {evaluation.findings.map((finding) => (
                  <li key={finding.id}>
                    <span className={`badge severity-${finding.severity}`}>{finding.severity}</span>{' '}
                    <strong dir="auto">{labelOf(finding.criterion)}</strong> —{' '}
                    <span dir="auto">{finding.evidence}</span>{' '}
                    <small className="muted">
                      ({text.location}: {finding.location}
                      {finding.targetStage ? `, ${text.targetStage}: ${finding.targetStage}` : ''})
                    </small>
                  </li>
                ))}
              </ul>
            )}
            {failedEvaluation && (
              <div className="toolbar">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  aria-expanded={pending?.kind === 'exception'}
                  onClick={() => setPending({ kind: 'exception', reason: '' })}
                >
                  {text.acceptException}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="exports-title">
        <h2 id="exports-title">{text.exports}</h2>
        <p className="muted">{text.exportHelp}</p>
        <div className="toolbar">
          {formats.map((format) => (
            <button
              key={format}
              className="secondary-button"
              type="button"
              disabled={busy || !canExport}
              onClick={() =>
                void run(async () => {
                  await apiSend('POST', `${base}/exports`, { format });
                  await load();
                }, text.done['export']!)
              }
            >
              {text.exportAs.replace('{format}', format.toUpperCase())}
            </button>
          ))}
        </div>
        <h3>{text.artifacts}</h3>
        {artifacts.length === 0 ? (
          <p className="muted">{text.artifactsNone}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="exports-title">
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.format}</th>
                  <th scope="col">{text.version.replace('{n}', '')}</th>
                  <th scope="col">{text.size}</th>
                  <th scope="col">{text.created}</th>
                  <th scope="col">
                    <span className="visually-hidden">{text.download}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact) => (
                  <tr key={artifact.id}>
                    <th scope="row" dir="ltr">
                      {artifact.format.toUpperCase()}
                    </th>
                    <td>{formatNumber(locale, artifact.documentVersion)}</td>
                    <td>{formatNumber(locale, Math.ceil(artifact.sizeBytes / 1024))} KB</td>
                    <td>{formatDateTime(locale, artifact.createdAt)}</td>
                    <td>
                      <a
                        className="secondary-button link-button"
                        href={`/api${base}/artifacts/${artifact.id}/download`}
                        download
                        aria-label={`${text.download}: ${artifact.format.toUpperCase()} ${formatNumber(locale, artifact.documentVersion)}`}
                      >
                        {text.download}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="versions-title">
        <h2 id="versions-title">{text.versions}</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="versions-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{text.version.replace('{n}', '')}</th>
                <th scope="col">{text.versionOrigin}</th>
                <th scope="col">{text.chars}</th>
                <th scope="col">{text.withinBounds}</th>
                <th scope="col">{text.reason}</th>
                <th scope="col">{text.created}</th>
                <th scope="col">
                  <span className="visually-hidden">{text.restore}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <th scope="row">{formatNumber(locale, version.versionNo)}</th>
                  <td>{text.origins[version.origin] ?? version.origin}</td>
                  <td>{formatNumber(locale, version.charCount)}</td>
                  <td>{version.withinBounds ? text.yes : text.no}</td>
                  <td dir="auto">{version.reason ?? '—'}</td>
                  <td>{formatDateTime(locale, version.createdAt)}</td>
                  <td>
                    {version.id !== current?.id && !['locked', 'superseded'].includes(status) && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        aria-label={`${text.restore}: ${formatNumber(locale, version.versionNo)}`}
                        onClick={() =>
                          setPending({
                            kind: 'restore',
                            versionId: version.id,
                            versionNo: version.versionNo,
                            reason: '',
                          })
                        }
                      >
                        {text.restore}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {versions.length > 1 && (
          <form className="filter-form" onSubmit={showDiff} aria-labelledby="compare-title">
            <h3 id="compare-title">{text.compare}</h3>
            <div className="filter-grid">
              <label htmlFor="diff-from">{text.compareFrom}</label>
              <select
                id="diff-from"
                value={diffFrom}
                onChange={(event) => setDiffFrom(event.target.value)}
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {formatNumber(locale, version.versionNo)}
                  </option>
                ))}
              </select>
              <label htmlFor="diff-to">{text.compareTo}</label>
              <select
                id="diff-to"
                value={diffTo}
                onChange={(event) => setDiffTo(event.target.value)}
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {formatNumber(locale, version.versionNo)}
                  </option>
                ))}
              </select>
            </div>
            <div className="toolbar">
              <button
                className="secondary-button"
                type="submit"
                disabled={busy || !diffFrom || !diffTo}
              >
                {text.showDiff}
              </button>
            </div>
          </form>
        )}
        {diff && (
          <div className="output-view" role="status">
            {diff.changes.length === 0 && !diff.titleChanged ? (
              <p>{text.diffNone}</p>
            ) : (
              <>
                <p>
                  {text.diffSummary
                    .replace('{added}', formatNumber(locale, diff.summary.added))
                    .replace('{removed}', formatNumber(locale, diff.summary.removed))
                    .replace('{changed}', formatNumber(locale, diff.summary.changed))
                    .replace('{moved}', formatNumber(locale, diff.summary.moved))}
                </p>
                {diff.titleChanged && <p>{text.titleChanged}</p>}
                <ul>
                  {diff.changes.map((change) => (
                    <li key={`${change.id}-${change.change}`}>
                      <strong>{text.changes[change.change] ?? change.change}</strong>{' '}
                      <span dir="ltr">
                        {change.type} · {change.id}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
