'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, apiGet, query } from '../../api-client';
import { formatDate, formatNumber, textDir, type Locale } from '../../i18n';
import { businessMessages } from '../projects/business-messages';
import type { BusinessContent, ContenterBusinessItem } from '../projects/business-types';
import {
  KnowledgeView,
  ProfileView,
  QualityView,
  SourcesView,
  safeHref,
} from '../projects/[projectId]/business-content';
import { WorkspacePage } from '../workspace-page';
import { businessesMessages } from './businesses-messages';

interface BusinessPage {
  items: ContenterBusinessItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; page: BusinessPage }
  | { kind: 'not_configured' }
  | { kind: 'failed' };

const PAGE_SIZE = 12;

/** The business profiles of Contenter (ADR-0021) as a tidy grid of cards. */
export function BusinessesPage({ locale }: { locale: Locale }) {
  const text = businessesMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Businesses locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

function Businesses({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = businessesMessages(locale);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [opened, setOpened] = useState<ContenterBusinessItem | null>(null);
  // Only the newest request may update the list.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const result = await apiGet<BusinessPage>(
        `/workspaces/${workspaceId}/contenter-businesses${query({
          q: search.trim() || undefined,
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })}`,
      );
      if (mine === latest.current) setState({ kind: 'ready', page: result });
    } catch (error) {
      if (mine !== latest.current) return;
      setState(
        error instanceof ApiError && error.code === 'CONTENTER_NOT_CONFIGURED'
          ? { kind: 'not_configured' }
          : { kind: 'failed' },
      );
    }
  }, [workspaceId, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(term);
  }

  if (state.kind === 'not_configured') {
    return (
      <section className="card stack">
        <p className="notice">{text.notConfigured}</p>
        <div className="toolbar">
          <Link className="secondary-button link-button" href={`/${locale}/integrations` as Route}>
            {text.openIntegrations}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <form className="business-search" role="search" onSubmit={submit}>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={text.search}
          aria-label={text.search}
          autoComplete="off"
        />
        <button className="secondary-button" type="submit">
          {text.searchButton}
        </button>
      </form>
      {opened && (
        <BusinessDialog
          locale={locale}
          workspaceId={workspaceId}
          item={opened}
          onClose={() => setOpened(null)}
        />
      )}
      {state.kind === 'loading' && <p role="status">{text.loading}</p>}
      {state.kind === 'failed' && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {state.kind === 'ready' && state.page.items.length === 0 && (
        <p className="muted">{text.empty}</p>
      )}
      {state.kind === 'ready' && state.page.items.length > 0 && (
        <>
          <p className="muted">
            {text.total.replace('{n}', formatNumber(locale, state.page.total))}
          </p>
          <ul className="business-grid" aria-label={text.title}>
            {state.page.items.map((item) => (
              <BusinessCard key={item.id} locale={locale} item={item} onOpen={setOpened} />
            ))}
          </ul>
          {state.page.totalPages > 1 && (
            <nav className="toolbar spread" aria-label={text.title}>
              <button
                className="secondary-button"
                type="button"
                disabled={state.page.page <= 1}
                onClick={() => setPage(state.page.page - 1)}
              >
                {text.previous}
              </button>
              <span className="muted">
                {text.pageOf
                  .replace('{page}', formatNumber(locale, state.page.page))
                  .replace('{total}', formatNumber(locale, state.page.totalPages))}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={state.page.page >= state.page.totalPages}
                onClick={() => setPage(state.page.page + 1)}
              >
                {text.next}
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function BusinessCard({
  locale,
  item,
  onOpen,
}: {
  locale: Locale;
  item: ContenterBusinessItem;
  onOpen: (item: ContenterBusinessItem) => void;
}) {
  const text = businessesMessages(locale);
  const percent =
    item.totalSections > 0 ? Math.round((item.filledSections / item.totalSections) * 100) : 0;
  const details: [string, string][] = [
    [text.industry, item.industry],
    [text.location, item.location],
    [text.language, item.language],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <li className="business-card">
      <div className="business-card-head">
        <span className="business-avatar" aria-hidden="true">
          {[...(item.name.trim() || '?')][0]}
        </span>
        <div className="business-card-title">
          <h2>
            <button type="button" className="business-open" onClick={() => onOpen(item)}>
              {item.name || text.unnamed}
            </button>
          </h2>
          {item.tagline && <p className="muted">{item.tagline}</p>}
        </div>
        {item.status && <span className="badge">{item.status}</span>}
      </div>
      {details.length > 0 && (
        <dl className="business-facts">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="business-progress">
        <div className="business-progress-label">
          <span>{text.sections}</span>
          <span>
            {formatNumber(locale, item.filledSections)} / {formatNumber(locale, item.totalSections)}
          </span>
        </div>
        <div
          className="business-progress-bar"
          role="progressbar"
          aria-label={text.sections}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ inlineSize: `${percent}%` }} />
        </div>
      </div>
      <div className="business-card-foot">
        <span>
          {text.topics}: {formatNumber(locale, item.topics)}
        </span>
        {item.updatedAt && (
          <span>
            {text.updated}: {formatDate(locale, item.updatedAt)}
          </span>
        )}
        {/^https?:\/\//iu.test(item.website) && (
          <a href={item.website} target="_blank" rel="noreferrer noopener" dir="ltr">
            {text.website}
          </a>
        )}
      </div>
    </li>
  );
}

type Detail =
  | { kind: 'loading' }
  | { kind: 'ready'; content: BusinessContent; contenterUrl: string | null }
  | { kind: 'failed' };

const DIALOG_VIEWS = ['profile', 'knowledge', 'sources', 'quality'] as const;
type DialogView = (typeof DIALOG_VIEWS)[number];

/**
 * A modal with the content of one business as Contenter holds it now (read live, nothing stored):
 * the profile, the facts and terms, the sources and assets and the quality, in the same views the
 * project's Business tab uses. If Contenter cannot be read, what the list knows is shown instead.
 */
function BusinessDialog({
  locale,
  workspaceId,
  item,
  onClose,
}: {
  locale: Locale;
  workspaceId: string;
  item: ContenterBusinessItem;
  onClose: () => void;
}) {
  const text = businessesMessages(locale);
  const panel = businessMessages(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail>({ kind: 'loading' });
  const [view, setView] = useState<DialogView>('profile');
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setDetail({ kind: 'loading' });
    apiGet<{ content: BusinessContent; contenterUrl: string | null }>(
      `/workspaces/${workspaceId}/contenter-businesses/${encodeURIComponent(item.id)}`,
    )
      .then((result) => {
        if (active)
          setDetail({ kind: 'ready', content: result.content, contenterUrl: result.contenterUrl });
      })
      .catch(() => {
        if (active) setDetail({ kind: 'failed' });
      });
    return () => {
      active = false;
    };
  }, [workspaceId, item.id]);

  const href =
    detail.kind === 'ready' && detail.contenterUrl ? safeHref(detail.contenterUrl) : null;
  return (
    <dialog
      ref={dialog}
      className="business-dialog business-dialog-wide"
      aria-labelledby="business-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="business-dialog-head">
        <div className="business-card-title">
          <h2 id="business-dialog-title" dir={textDir(locale)}>
            {item.name || text.unnamed}
          </h2>
          {item.tagline && (
            <p className="muted" dir={textDir(locale)}>
              {item.tagline}
            </p>
          )}
        </div>
        <div className="toolbar">
          {href && (
            <a
              className="secondary-button link-button"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              title={panel.openInContenterHint}
            >
              {panel.openInContenter}
            </a>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => dialog.current?.close()}
          >
            {text.close}
          </button>
        </div>
      </div>
      {detail.kind === 'loading' && <p role="status">{text.detailLoading}</p>}
      {detail.kind === 'failed' && (
        <>
          <p className="notice error" role="alert">
            {text.detailFailed}
          </p>
          <ListSummary locale={locale} item={item} />
        </>
      )}
      {detail.kind === 'ready' && (
        <>
          <nav className="section-nav biz-tabs" aria-label={panel.panel.views}>
            <ul>
              {DIALOG_VIEWS.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    aria-current={view === name ? 'page' : undefined}
                    onClick={() => setView(name)}
                  >
                    {panel.panel.viewNames[name]}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {view === 'profile' && <ProfileView locale={locale} content={detail.content} />}
          {view === 'knowledge' && (
            <KnowledgeView locale={locale} content={detail.content} now={now} />
          )}
          {view === 'sources' && <SourcesView locale={locale} content={detail.content} />}
          {view === 'quality' && <QualityView locale={locale} content={detail.content} />}
        </>
      )}
    </dialog>
  );
}

/** What the list itself knows about a business, in three groups (used if Contenter is unreadable). */
function ListSummary({ locale, item }: { locale: Locale; item: ContenterBusinessItem }) {
  const text = businessesMessages(locale);
  const percent =
    item.totalSections > 0 ? Math.round((item.filledSections / item.totalSections) * 100) : 0;
  const isLink = /^https?:\/\//iu.test(item.website);
  const groups: { title: string; rows: [string, ReactNode][] }[] = [
    {
      title: text.groupProfile,
      rows: [
        [text.industry, item.industry],
        [text.location, item.location],
        [text.language, item.language],
        [
          text.website,
          isLink ? (
            <a href={item.website} target="_blank" rel="noreferrer noopener" dir="ltr">
              {item.website}
            </a>
          ) : (
            item.website
          ),
        ],
      ],
    },
    {
      title: text.groupContent,
      rows: [
        [text.status, item.status],
        [
          text.sections,
          `${formatNumber(locale, item.filledSections)} / ${formatNumber(locale, item.totalSections)} (${formatNumber(locale, percent)}٪)`,
        ],
        [text.topics, formatNumber(locale, item.topics)],
        [text.updated, item.updatedAt ? formatDate(locale, item.updatedAt) : ''],
      ],
    },
  ];
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} className="business-dialog-group">
          <h3>{group.title}</h3>
          <dl className="business-facts">
            {group.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
