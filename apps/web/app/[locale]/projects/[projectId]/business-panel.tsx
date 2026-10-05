'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { AiView, VersionsView } from './business-ai';
import { KnowledgeView, ProfileView, QualityView, SourcesView, safeHref } from './business-content';
import { businessMessages } from '../business-messages';
import { BusinessPicker } from '../business-picker';
import type {
  BusinessContent,
  BusinessView,
  ContenterBusinessItem,
  HistoryItem,
} from '../business-types';

const VIEWS = ['profile', 'knowledge', 'sources', 'quality', 'ai', 'versions'] as const;
type ViewName = (typeof VIEWS)[number];

type Mode = null | 'change' | 'unlink';

/**
 * The business of a project, read from Contenter (ADR-0021): everything Contenter holds about it,
 * what each agent role is given, and the versions Docoo has kept. It is read-only here; the
 * profile is edited in Contenter and a sync brings the change in as a new version.
 */
export function BusinessPanel({
  locale,
  workspaceId,
  projectId,
  readOnly,
  refreshKey,
  onChanged,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly readOnly: boolean;
  readonly refreshKey: number;
  readonly onChanged: () => void;
}) {
  const text = businessMessages(locale);
  const panel = text.panel;
  const id = useId();
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [view, setView] = useState<BusinessView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [current, setCurrent] = useState<ViewName>('profile');
  const [shown, setShown] = useState<{
    id: string;
    versionNo: number;
    content: BusinessContent;
  } | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [picked, setPicked] = useState<ContenterBusinessItem | null>(null);
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState(0);
  // What counts as expired is decided once per visit, so the page does not shift while it is read.
  const [now] = useState(() => Date.now());
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);

  const reload = useCallback(async () => {
    try {
      setView(await apiGet<BusinessView>(`${base}/business`));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [base]);

  useEffect(() => {
    setShown(null);
    void reload();
  }, [reload, refreshKey]);

  const changed = useCallback(() => {
    setLocal((value) => value + 1);
    onChanged();
  }, [onChanged]);

  async function sync() {
    setNotice(null);
    const ok = await run(async () => {
      const result = await apiSend<BusinessView & { changed: boolean; versionNo: number }>(
        'POST',
        `${base}/business/sync`,
        {},
      );
      setView(result);
      setShown(null);
      setNotice({
        ok: true,
        text: result.changed
          ? fill(panel.syncedChanged, { version: formatNumber(locale, result.versionNo) })
          : panel.syncedSame,
      });
      changed();
    }, '');
    // A failed sync leaves its reason on the link; show it.
    if (!ok) await reload();
  }

  function link(item: ContenterBusinessItem) {
    void run(async () => {
      const result = await apiSend<BusinessView>('PUT', `${base}/business`, {
        externalBusinessId: item.id,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setView(result);
      setShown(null);
      setMode(null);
      setPicked(null);
      setReason('');
      changed();
    }, panel.linked);
  }

  function unlink() {
    void run(async () => {
      const result = await apiSend<BusinessView>('POST', `${base}/business/unlink`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setView(result);
      setShown(null);
      setMode(null);
      setReason('');
      changed();
    }, panel.unlinked);
  }

  function showVersion(item: HistoryItem) {
    if (item.current) {
      setShown(null);
      setCurrent('profile');
      return;
    }
    void run(async () => {
      const result = await apiGet<{ snapshot: { content: BusinessContent } }>(
        `${base}/business/snapshots/${item.id}`,
      );
      setShown({ id: item.id, versionNo: item.versionNo, content: result.snapshot.content });
      setCurrent('profile');
    }, '');
  }

  if (loadFailed && !view) {
    return (
      <div className="stack">
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={() => void reload()}>
            {text.retry}
          </button>
        </div>
      </div>
    );
  }
  if (!view) return <p role="status">{text.loading}</p>;

  const frozen = readOnly;
  // ---- not linked yet ----
  if (!view.link || !view.snapshot) {
    return (
      <div className="stack">
        <section className="card stack" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{panel.notLinked}</h2>
          <p dir="auto">{panel.notLinkedHelp}</p>
          <Notice notice={notice} />
          {frozen ? null : (
            <>
              <BusinessPicker
                locale={locale}
                workspaceId={workspaceId}
                value={picked}
                onChange={setPicked}
                disabled={busy}
              />
              <div className="toolbar">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || picked === null}
                  onClick={() => picked && link(picked)}
                >
                  {busy ? panel.linking : panel.link}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  const snapshot = view.snapshot;
  const content = shown?.content ?? snapshot.content;
  const contenterHref = view.link.contenterUrl ? safeHref(view.link.contenterUrl) : null;
  const connectionBad = view.connection.status !== 'healthy';

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby={`${id}-head`} data-testid="business-header">
        <h2 id={`${id}-head`} dir="auto">
          {panel.title}: {view.link.name}
        </h2>
        <p className="muted" dir="auto">
          {panel.readOnlyNote}
        </p>
        <dl className="facts">
          <div>
            <dt>{panel.version}</dt>
            <dd data-testid="business-version">{formatNumber(locale, snapshot.versionNo)}</dd>
          </div>
          <div>
            <dt>{panel.syncedAt}</dt>
            <dd>
              {view.link.syncedAt ? formatDateTime(locale, view.link.syncedAt) : panel.neverSynced}
            </dd>
          </div>
          <div>
            <dt>{panel.exportedAt}</dt>
            <dd>{snapshot.exportedAt ? formatDateTime(locale, snapshot.exportedAt) : '—'}</dd>
          </div>
          <div>
            <dt>{panel.linkedAt}</dt>
            <dd>{formatDateTime(locale, view.link.linkedAt)}</dd>
          </div>
        </dl>
        {view.link.syncError && (
          <p className="notice error" role="status">
            {fill(panel.syncProblem, {
              reason: panel.syncReasons[view.link.syncError] ?? view.link.syncError,
            })}
          </p>
        )}
        {connectionBad && (
          <p className="notice error" role="status">
            {fill(panel.connectionDown, { status: view.connection.status })}{' '}
            <Link href={`/${locale}/integrations` as Route}>{panel.manageConnection}</Link>
          </p>
        )}
        <Notice notice={notice} />
        <div className="toolbar" role="group" aria-label={panel.title}>
          {!frozen && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void sync()}
            >
              {busy && mode === null ? panel.syncing : panel.sync}
            </button>
          )}
          {!frozen && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              aria-expanded={mode === 'change'}
              onClick={() => {
                setNotice(null);
                setReason('');
                setPicked(null);
                setMode(mode === 'change' ? null : 'change');
              }}
            >
              {panel.change}
            </button>
          )}
          {!frozen && (
            <button
              className="secondary-button danger"
              type="button"
              disabled={busy}
              aria-expanded={mode === 'unlink'}
              onClick={() => {
                setNotice(null);
                setReason('');
                setMode(mode === 'unlink' ? null : 'unlink');
              }}
            >
              {panel.unlink}
            </button>
          )}
          {contenterHref && (
            <a
              className="secondary-button"
              href={contenterHref}
              target="_blank"
              rel="noopener noreferrer"
              title={text.openInContenterHint}
            >
              {text.openInContenter}
            </a>
          )}
        </div>

        {mode === 'change' && (
          <div className="card confirm-panel stack" role="group" aria-labelledby={`${id}-change`}>
            <h3 id={`${id}-change`}>{panel.change}</h3>
            <p>{panel.changeHelp}</p>
            <BusinessPicker
              locale={locale}
              workspaceId={workspaceId}
              value={picked}
              onChange={setPicked}
              disabled={busy}
            />
            <div className="filter-grid">
              <label htmlFor={`${id}-reason`}>{panel.reason}</label>
              <input
                id={`${id}-reason`}
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="toolbar">
              <button
                className="primary-button"
                type="button"
                disabled={busy || picked === null}
                onClick={() => picked && link(picked)}
              >
                {busy ? panel.linking : panel.confirm}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setMode(null)}
              >
                {panel.cancel}
              </button>
            </div>
          </div>
        )}
        {mode === 'unlink' && (
          <div className="card confirm-panel stack" role="group" aria-labelledby={`${id}-unlink`}>
            <h3 id={`${id}-unlink`}>{panel.unlink}</h3>
            <p>{panel.unlinkHelp}</p>
            <div className="filter-grid">
              <label htmlFor={`${id}-unlink-reason`}>{panel.reason}</label>
              <input
                id={`${id}-unlink-reason`}
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="toolbar">
              <button className="primary-button" type="button" disabled={busy} onClick={unlink}>
                {busy ? panel.working : panel.confirm}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setMode(null)}
              >
                {panel.cancel}
              </button>
            </div>
          </div>
        )}
      </section>

      <nav className="section-nav" aria-label={panel.views}>
        <ul>
          {VIEWS.map((item) => (
            <li key={item}>
              <button
                type="button"
                aria-current={current === item ? 'page' : undefined}
                onClick={() => setCurrent(item)}
              >
                {panel.viewNames[item]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {shown && current !== 'versions' && current !== 'ai' && (
        <p className="notice" role="status" data-testid="business-old-version">
          {fill(text.versions.shown, { version: formatNumber(locale, shown.versionNo) })}{' '}
          <button className="link-button" type="button" onClick={() => setShown(null)}>
            {text.versions.back}
          </button>
        </p>
      )}

      {current === 'profile' && <ProfileView locale={locale} content={content} />}
      {current === 'knowledge' && <KnowledgeView locale={locale} content={content} now={now} />}
      {current === 'sources' && <SourcesView locale={locale} content={content} />}
      {current === 'quality' && <QualityView locale={locale} content={content} />}
      {current === 'ai' && <AiView locale={locale} base={base} refreshKey={refreshKey + local} />}
      {current === 'versions' && (
        <VersionsView
          locale={locale}
          base={base}
          refreshKey={refreshKey + local}
          shownId={shown?.id ?? snapshot.id}
          onShow={showVersion}
        />
      )}
    </div>
  );
}
