'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiGet, query } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { businessMessages, joinList, sectionTitle } from '../business-messages';
import type { ContextPreview, HistoryItem, RolePreview } from '../business-types';

const failedText = (error: unknown, locale: Locale): string => {
  const text = businessMessages(locale);
  return (error instanceof ApiError && error.code && text.errors[error.code]) || text.loadFailed;
};

/** What each agent role is given from the business: sizes per role and the exact data on request. */
export function AiView({
  locale,
  base,
  refreshKey,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly refreshKey: number;
}) {
  const text = businessMessages(locale);
  const ai = text.ai;
  const [context, setContext] = useState<ContextPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<RolePreview | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let active = true;
    setOpen(null);
    setDetail(null);
    apiGet<ContextPreview>(`${base}/business/context`)
      .then((result) => {
        if (!active) return;
        setContext(result);
        setError(null);
      })
      .catch((failure: unknown) => active && setError(failedText(failure, locale)));
    return () => {
      active = false;
    };
  }, [base, refreshKey, locale]);

  const show = useCallback(
    async (role: string) => {
      if (open === role) {
        setOpen(null);
        setDetail(null);
        return;
      }
      const mine = ++latest.current;
      setOpen(role);
      setDetail(null);
      setDetailError(null);
      try {
        const result = await apiGet<ContextPreview>(`${base}/business/context${query({ role })}`);
        if (mine !== latest.current) return;
        setDetail(result.roles.find((item) => item.role === role) ?? null);
      } catch (failure) {
        if (mine === latest.current) setDetailError(failedText(failure, locale));
      }
    },
    [base, open, locale],
  );

  if (error) {
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  }
  if (!context) return <p role="status">{text.loading}</p>;
  if (!context.linked) return <p className="muted">{ai.notLinked}</p>;

  return (
    <section className="card stack" aria-labelledby="biz-ai">
      <h3 id="biz-ai">{ai.title}</h3>
      <p className="muted">{ai.help}</p>
      <p>{fill(ai.budget, { chars: formatNumber(locale, context.budgetChars) })}</p>
      <p className="notice" role="note">
        {ai.privacy}
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="biz-ai">
        <table data-testid="business-roles">
          <thead>
            <tr>
              <th scope="col">{ai.role}</th>
              <th scope="col">{ai.chars}</th>
              <th scope="col">{ai.sectionsCount}</th>
              <th scope="col">{ai.facts}</th>
              <th scope="col">{ai.terms}</th>
              <th scope="col">{ai.notes}</th>
              <th scope="col">{ai.omitted}</th>
              <th scope="col">
                <span className="visually-hidden">{ai.show}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {context.roles.map((role) => (
              <tr key={role.role} data-testid={`business-role-${role.role}`}>
                <th scope="row">{ai.roles[role.role] ?? role.role}</th>
                {role.summary === null ? (
                  <td colSpan={6} className="muted">
                    {role.role === 'brain' ? ai.noneReason : ai.none}
                  </td>
                ) : (
                  <>
                    <td>
                      {formatNumber(locale, role.summary.chars)}
                      <span className="muted">
                        {' '}
                        / {formatNumber(locale, role.summary.budgetChars)}
                      </span>
                    </td>
                    <td>
                      {formatNumber(locale, role.summary.sections.length)}
                      {role.summary.sections.some((section) => section.truncated) && (
                        <span className="badge tone-warn">{ai.truncated}</span>
                      )}
                    </td>
                    <td>{formatNumber(locale, role.summary.facts)}</td>
                    <td>{formatNumber(locale, role.summary.terms)}</td>
                    <td>{formatNumber(locale, role.summary.notes)}</td>
                    <td dir="auto">
                      {role.summary.omitted.length > 0
                        ? joinList(
                            locale,
                            role.summary.omitted.map((key) => sectionTitle(locale, key)),
                          )
                        : '—'}
                    </td>
                  </>
                )}
                <td>
                  {role.summary !== null && (
                    <button
                      className="secondary-button"
                      type="button"
                      aria-expanded={open === role.role}
                      aria-controls={`biz-role-${role.role}`}
                      onClick={() => void show(role.role)}
                    >
                      {open === role.role ? ai.hide : ai.show}
                      <span className="visually-hidden"> — {ai.roles[role.role] ?? role.role}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div id={`biz-role-${open}`} className="stack" data-testid="business-role-detail">
          <h4>{fill(ai.exact, { role: ai.roles[open] ?? open })}</h4>
          {detailError ? (
            <p className="notice error" role="alert">
              {detailError}
            </p>
          ) : !detail ? (
            <p role="status">{ai.loadingRole}</p>
          ) : detail.data ? (
            <div className="output-view">
              <h5>{ai.sectionsIncluded}</h5>
              {detail.data.sections.map((section) => (
                <details key={section.key} open>
                  <summary>
                    <strong dir="auto">{sectionTitle(locale, section.key)}</strong>
                    {!section.confirmed && <span className="badge tone-warn">{ai.draftMark}</span>}
                  </summary>
                  <div className="pre-text" dir="auto">
                    {section.text}
                  </div>
                </details>
              ))}
              {detail.data.notIncluded.length > 0 && (
                <p className="muted" dir="auto">
                  {ai.notIncluded}:{' '}
                  {joinList(
                    locale,
                    detail.data.notIncluded.map((key) => sectionTitle(locale, key)),
                  )}
                </p>
              )}
              {detail.data.keyFacts.length > 0 && (
                <>
                  <h5>{ai.keyFacts}</h5>
                  <ul>
                    {detail.data.keyFacts.map((fact, index) => (
                      <li key={`${fact.label}-${index}`} dir="auto">
                        <strong>{fact.label}:</strong> {fact.value}
                        {!fact.verified && <span className="badge tone-warn">{ai.draftMark}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.data.terminology && detail.data.terminology.length > 0 && (
                <>
                  <h5>{ai.terminology}</h5>
                  <ul>
                    {detail.data.terminology.map((term, index) => (
                      <li key={`${term.term}-${index}`} dir="auto">
                        {term.rule}: <strong>{term.term}</strong>
                        {term.alternatives.length > 0 &&
                          ` → ${joinList(locale, term.alternatives)}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.data.adminNotes.length > 0 && (
                <>
                  <h5>{ai.notesSent}</h5>
                  <ul>
                    {detail.data.adminNotes.map((note, index) => (
                      <li key={`${note}-${index}`} dir="auto" className="pre-text">
                        {note}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.rules && detail.rules.length > 0 && (
                <>
                  <h5>{ai.rules}</h5>
                  <ol dir="ltr">
                    {detail.rules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ) : (
            <p className="muted">{ai.none}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** The versions Docoo has kept, and how many runs and writings read each (they stay pinned). */
export function VersionsView({
  locale,
  base,
  refreshKey,
  shownId,
  onShow,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly refreshKey: number;
  readonly shownId: string | null;
  readonly onShow: (item: HistoryItem) => void;
}) {
  const text = businessMessages(locale);
  const v = text.versions;
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<{ items: HistoryItem[] }>(`${base}/business/snapshots`)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setError(null);
      })
      .catch((failure: unknown) => active && setError(failedText(failure, locale)));
    return () => {
      active = false;
    };
  }, [base, refreshKey, locale]);

  if (error) {
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  }
  if (!items) return <p role="status">{text.loading}</p>;

  return (
    <section className="card stack" aria-labelledby="biz-versions">
      <h3 id="biz-versions">{v.title}</h3>
      <p className="muted">{v.help}</p>
      {items.length === 0 ? (
        <p className="muted">{v.none}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="biz-versions">
          <table data-testid="business-versions">
            <thead>
              <tr>
                <th scope="col">{v.version}</th>
                <th scope="col">{v.fetchedAt}</th>
                <th scope="col">{v.changes}</th>
                <th scope="col">{v.used}</th>
                <th scope="col">{v.shortHash}</th>
                <th scope="col">
                  <span className="visually-hidden">{v.show}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const parts: string[] = [];
                if (item.changes.sections.length > 0) {
                  parts.push(
                    fill(v.changeSections, {
                      names: joinList(
                        locale,
                        item.changes.sections.map((key) => sectionTitle(locale, key)),
                      ),
                    }),
                  );
                }
                if (item.changes.facts) parts.push(v.changeFacts);
                if (item.changes.terms) parts.push(v.changeTerms);
                if (item.changes.notes) parts.push(v.changeNotes);
                if (item.changes.details) parts.push(v.changeDetails);
                return (
                  <tr key={item.id} data-testid={`business-version-${item.versionNo}`}>
                    <th scope="row">
                      {formatNumber(locale, item.versionNo)}
                      {item.current && <span className="badge tone-ok">{v.current}</span>}
                    </th>
                    <td>{formatDateTime(locale, item.fetchedAt)}</td>
                    <td dir="auto">
                      {item.versionNo === 1 ? v.first : parts.length > 0 ? parts.join(' · ') : '—'}
                    </td>
                    <td>
                      {item.runs + item.writings === 0
                        ? '—'
                        : [
                            item.runs > 0
                              ? fill(v.runs, { count: formatNumber(locale, item.runs) })
                              : null,
                            item.writings > 0
                              ? fill(v.writings, { count: formatNumber(locale, item.writings) })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </td>
                    <td dir="ltr">
                      <code>{item.contentSha256.slice(0, 10)}</code>
                    </td>
                    <td>
                      <button
                        className="secondary-button"
                        type="button"
                        aria-pressed={shownId === item.id}
                        onClick={() => onShow(item)}
                      >
                        {v.show}
                        <span className="visually-hidden">
                          {' '}
                          — {formatNumber(locale, item.versionNo)}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
