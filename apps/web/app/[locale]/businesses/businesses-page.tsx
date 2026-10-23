'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, apiGet, query } from '../../api-client';
import { formatDate, formatNumber, type Locale } from '../../i18n';
import type { ContenterBusinessItem } from '../projects/business-types';
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
      {opened && <BusinessDialog locale={locale} item={opened} onClose={() => setOpened(null)} />}
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

/** A modal with everything the list knows about one business, grouped into categories. */
function BusinessDialog({
  locale,
  item,
  onClose,
}: {
  locale: Locale;
  item: ContenterBusinessItem;
  onClose: () => void;
}) {
  const text = businessesMessages(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const percent =
    item.totalSections > 0 ? Math.round((item.filledSections / item.totalSections) * 100) : 0;
  const isLink = /^https?:\/\//iu.test(item.website);
  const groups: { title: string; rows: [string, ReactNode][] }[] = [
    {
      title: text.groupIntro,
      rows: [
        [text.name, item.name || text.unnamed],
        [text.tagline, item.tagline],
      ],
    },
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
    <dialog
      ref={dialog}
      className="business-dialog"
      aria-labelledby="business-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="business-dialog-head">
        <h2 id="business-dialog-title">{item.name || text.unnamed}</h2>
        <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>
          {text.close}
        </button>
      </div>
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
    </dialog>
  );
}
