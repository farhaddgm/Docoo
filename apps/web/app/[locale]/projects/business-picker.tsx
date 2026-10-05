'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { ApiError, apiGet, query } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { businessMessages } from './business-messages';
import type { ContenterBusinessItem } from './business-types';

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
  | { kind: 'failed'; message: string };

const PAGE_SIZE = 20;

/**
 * Chooses one of the businesses defined in Contenter (ADR-0021). It is not a form of its own, so
 * it can sit inside the project wizard; the search runs on the button or on Enter.
 */
export function BusinessPicker({
  locale,
  workspaceId,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly value: ContenterBusinessItem | null;
  readonly onChange: (next: ContenterBusinessItem | null) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
}) {
  const text = businessMessages(locale);
  const picker = text.picker;
  const id = useId();
  const [term, setTerm] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [searching, setSearching] = useState(false);
  // Only the newest request may update the list: a slow earlier one must not bring old rows back.
  const latest = useRef(0);

  const load = useCallback(
    async (search: string, page: number) => {
      const mine = ++latest.current;
      setSearching(true);
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
        if (error instanceof ApiError && error.code === 'CONTENTER_NOT_CONFIGURED') {
          setState({ kind: 'not_configured' });
        } else {
          setState({
            kind: 'failed',
            message:
              (error instanceof ApiError && error.code && text.errors[error.code]) ||
              picker.unreachable,
          });
        }
      } finally {
        if (mine === latest.current) setSearching(false);
      }
    },
    [workspaceId, text, picker.unreachable],
  );

  // The first page is read when the picker opens (and again only if the workspace changes).
  useEffect(() => {
    void load('', 1);
  }, [load]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void load(term, 1);
  }

  const headingId = `${id}-title`;
  return (
    <section className="stack" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {picker.title}
        {required && <span aria-hidden="true"> *</span>}
      </h3>
      <p className="muted" dir="auto">
        {picker.help}
      </p>
      {required && (
        <p className="muted" dir="auto">
          {picker.required}
        </p>
      )}
      <p aria-live="polite" data-testid="business-selected">
        <strong>{picker.selected}:</strong>{' '}
        {value ? (
          <span dir="auto">
            {value.name}
            {value.industry ? ` — ${value.industry}` : ''}
          </span>
        ) : (
          <span className="muted">{picker.noneSelected}</span>
        )}{' '}
        {value && (
          <button
            className="link-button"
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            {picker.clear}
          </button>
        )}
      </p>

      {state.kind === 'not_configured' ? (
        <p className="notice error" role="status">
          {picker.notConfigured}{' '}
          <Link href={`/${locale}/integrations` as Route}>{picker.goToIntegrations}</Link>
        </p>
      ) : state.kind === 'failed' ? (
        <div className="stack">
          <p className="notice error" role="alert">
            {state.message}
          </p>
          <div className="toolbar">
            <button className="secondary-button" type="button" onClick={() => void load(term, 1)}>
              {text.retry}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="filter-grid">
            <label htmlFor={`${id}-search`}>{picker.search}</label>
            <div className="toolbar">
              <input
                id={`${id}-search`}
                type="search"
                value={term}
                maxLength={200}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                disabled={disabled}
              />
              <button
                className="secondary-button"
                type="button"
                disabled={disabled || searching}
                onClick={() => void load(term, 1)}
              >
                {searching ? picker.searching : picker.searchButton}
              </button>
            </div>
          </div>
          {state.kind === 'loading' ? (
            <p role="status">{text.loading}</p>
          ) : state.page.items.length === 0 ? (
            <p className="muted" role="status">
              {picker.none}
            </p>
          ) : (
            <fieldset className="field-stack" disabled={disabled} aria-busy={searching}>
              <legend className="visually-hidden">{picker.results}</legend>
              <ul className="plain-list">
                {state.page.items.map((item) => (
                  <li key={item.id}>
                    <label className="mode-choice">
                      <input
                        type="radio"
                        name={`${id}-choice`}
                        checked={value?.id === item.id}
                        onChange={() => onChange(item)}
                      />
                      <span>
                        <strong dir="auto">{item.name}</strong>
                        {item.industry && <span dir="auto"> — {item.industry}</span>}
                        <br />
                        <small className="muted">
                          {fill(picker.filled, {
                            filled: formatNumber(locale, item.filledSections),
                            total: formatNumber(locale, item.totalSections),
                          })}
                          {' · '}
                          {fill(picker.topics, { count: formatNumber(locale, item.topics) })}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {state.kind === 'ready' && state.page.totalPages > 1 && (
            <nav className="toolbar" aria-label={picker.results}>
              <button
                className="secondary-button"
                type="button"
                disabled={disabled || searching || state.page.page <= 1}
                onClick={() => void load(term, state.page.page - 1)}
              >
                {picker.previous}
              </button>
              <span>
                {fill(picker.page, {
                  page: formatNumber(locale, state.page.page),
                  pages: formatNumber(locale, state.page.totalPages),
                })}
              </span>
              <button
                className="secondary-button"
                type="button"
                disabled={disabled || searching || state.page.page >= state.page.totalPages}
                onClick={() => void load(term, state.page.page + 1)}
              >
                {picker.next}
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
