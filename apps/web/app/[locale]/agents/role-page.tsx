'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { apiGet, apiSend, idempotencyKey } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { SignedIn } from '../signed-in';
import { explainError, Notice, useAction } from '../use-action';
import { agentMessages, fill } from './agent-messages';
import type { AgentRole, Definition, RoleDetail, RoleOutput } from './agent-types';
import { RoleEditor } from './role-editor';

export function RolePage({ locale, role }: { locale: Locale; role: AgentRole }) {
  const text = agentMessages(locale);
  return (
    <SignedIn locale={locale} title={text.roles[role].name} subtitle={text.roles[role].mission}>
      {(identity) =>
        identity.workspaces[0] ? (
          <Role locale={locale} workspaceId={identity.workspaces[0].id} role={role} />
        ) : null
      }
    </SignedIn>
  );
}

interface History {
  items: Definition[];
  activeVersionId: string;
  nextBefore: number | null;
}

function SectionChips({ definition, locale }: { definition: Definition; locale: Locale }) {
  const text = agentMessages(locale);
  if (definition.changedSections.length === 0) {
    return <span className="muted">{text.nothingChanged}</span>;
  }
  return (
    <span className="chips">
      <span className="muted">{text.changedLabel}:</span>{' '}
      {definition.changedSections.map((section) => (
        <span key={section} className="badge">
          {text.sections[section]}
        </span>
      ))}
    </span>
  );
}

/** Activate a freshly saved version: needs a reason like every activation. */
function ActivatePanel({
  locale,
  saved,
  active,
  onActivate,
  busy,
}: {
  locale: Locale;
  saved: Definition;
  active: boolean;
  onActivate: (id: string, reason: string) => Promise<void>;
  busy: boolean;
}) {
  const text = agentMessages(locale);
  const id = useId();
  const [reason, setReason] = useState('');
  if (active) {
    return (
      <p className="notice ok" role="status">
        {fill(text.activated, { n: formatNumber(locale, saved.sequence) })}
      </p>
    );
  }
  return (
    <section className="card stack" aria-labelledby={`${id}-saved`}>
      <p id={`${id}-saved`} className="notice ok" role="status">
        {fill(text.savedNotActive, { n: formatNumber(locale, saved.sequence) })}
      </p>
      <div className="field-stack">
        <label htmlFor={`${id}-reason`}>{text.activateReason}</label>
        <input
          id={`${id}-reason`}
          dir="auto"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <p className="toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={busy || reason.trim().length < 3}
          onClick={() => void onActivate(saved.id, reason.trim())}
        >
          {fill(text.activateNow, { n: formatNumber(locale, saved.sequence) })}
        </button>
      </p>
    </section>
  );
}

function Role({
  locale,
  workspaceId,
  role,
}: {
  locale: Locale;
  workspaceId: string;
  role: AgentRole;
}) {
  const text = agentMessages(locale);
  const base = `/workspaces/${workspaceId}/agent-roles/${role}`;
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [outputs, setOutputs] = useState<{ items: RoleOutput[]; nextCursor: string | null } | null>(
    null,
  );
  const [editBase, setEditBase] = useState<Definition | null>(null);
  const [activateReason, setActivateReason] = useState('');
  const [failed, setFailed] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const reasonId = useId();

  const load = useCallback(async () => {
    const [role_, versions] = await Promise.all([
      apiGet<RoleDetail>(base),
      apiGet<History>(`${base}/definitions?limit=20`),
    ]);
    setDetail(role_);
    setHistory(versions);
  }, [base]);

  useEffect(() => {
    load().catch(() => setFailed(true));
    apiGet<{ items: RoleOutput[]; nextCursor: string | null }>(`${base}/outputs?limit=10`)
      .then(setOutputs)
      .catch(() => setOutputs({ items: [], nextCursor: null }));
  }, [load, base]);

  async function activate(id: string, reason: string) {
    await run(
      async () => {
        const result = await apiSend<{ changed: boolean; definition: Definition }>(
          'POST',
          `${base}/definitions/${id}/activate`,
          { reason },
          { headers: { 'idempotency-key': idempotencyKey() } },
        );
        setEditBase(null);
        setActivateReason('');
        await load();
        return void result;
      },
      text.activated.replace('{n}', ''),
    );
  }

  async function olderVersions() {
    if (!history?.nextBefore) return;
    await run(async () => {
      const more = await apiGet<History>(
        `${base}/definitions?limit=20&before=${history.nextBefore}`,
      );
      setHistory({
        ...history,
        items: [...history.items, ...more.items],
        nextBefore: more.nextBefore,
      });
    }, '');
  }

  async function moreOutputs() {
    if (!outputs?.nextCursor) return;
    await run(async () => {
      const more = await apiGet<{ items: RoleOutput[]; nextCursor: string | null }>(
        `${base}/outputs?limit=10&cursor=${encodeURIComponent(outputs.nextCursor!)}`,
      );
      setOutputs({ items: [...outputs.items, ...more.items], nextCursor: more.nextCursor });
    }, '');
  }

  if (failed) {
    return (
      <p className="notice error" role="alert">
        {text.failed}
      </p>
    );
  }
  if (!detail || !history) return <p role="status">{text.loading}</p>;

  const startFrom = editBase ?? detail.definition;
  const stageLabel = detail.stage ? (text.stages[detail.stage] ?? detail.stage) : text.sideRole;
  const performance = detail.performance;

  return (
    <div className="stack">
      <p>
        <Link href={`/${locale}/agents` as Route}>{text.back}</Link>
      </p>
      <section className="card stack" aria-labelledby="role-heading">
        <h2 id="role-heading">{text.roles[role].name}</h2>
        <p className="muted">{text.roleSubtitle}</p>
        <p>
          <span className="badge">{stageLabel}</span>{' '}
          <span className="badge state-passed">
            {fill(text.versionLabel, { n: formatNumber(locale, detail.definition.sequence) })} ·{' '}
            {text.active}
          </span>
        </p>
      </section>

      <section className="card stack" aria-labelledby="editor-heading">
        <h2 id="editor-heading" ref={editorHeading} tabIndex={-1}>
          {text.editorHeading}
        </h2>
        <p className="muted">
          {fill(text.editFrom, { n: formatNumber(locale, startFrom.sequence) })}
        </p>
        <RoleEditor
          key={startFrom.id}
          locale={locale}
          workspaceId={workspaceId}
          base={startFrom}
          reference={detail}
          serverWarnings={startFrom.id === detail.definition.id ? detail.modelWarnings : []}
          saveLabel={text.save}
          submit={async (changes, reason) => {
            const result = await apiSend<{ definition: Definition }>(
              'POST',
              `${base}/definitions`,
              {
                changes,
                reason,
                baseVersionId: startFrom.id,
                expectedSequence: detail.latestSequence,
              },
              { headers: { 'idempotency-key': idempotencyKey() } },
            );
            await load();
            return result.definition;
          }}
          after={(saved) => (
            <ActivatePanel
              locale={locale}
              saved={saved}
              active={history.activeVersionId === saved.id}
              busy={busy}
              onActivate={activate}
            />
          )}
        />
      </section>

      <section className="card stack" aria-labelledby="history-heading">
        <h2 id="history-heading">{text.historyHeading}</h2>
        <p className="muted">{text.historyHelp}</p>
        <div className="field-stack">
          <label htmlFor={reasonId}>{text.activateReason}</label>
          <input
            id={reasonId}
            dir="auto"
            value={activateReason}
            maxLength={1000}
            onChange={(event) => setActivateReason(event.target.value)}
            aria-describedby={`${reasonId}-help`}
          />
          <small id={`${reasonId}-help`} className="muted">
            {text.activateReasonHelp}
          </small>
        </div>
        <Notice notice={notice} />
        <ol className="version-list">
          {history.items.map((item) => {
            const label = fill(text.versionLabel, { n: formatNumber(locale, item.sequence) });
            const isActive = item.id === history.activeVersionId;
            return (
              <li key={item.id} className="version-row">
                <h3>
                  {label} {isActive && <span className="badge state-passed">{text.active}</span>}
                </h3>
                <p className="muted">
                  {text.createdAt}: {formatDateTime(locale, item.createdAt)}
                </p>
                <p>
                  {text.reasonOf}: <span dir="auto">{item.reason}</span>
                </p>
                <p>
                  <SectionChips definition={item} locale={locale} />
                </p>
                <p className="toolbar">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    aria-label={`${text.editFromThis}: ${label}`}
                    onClick={() => {
                      setEditBase(item.id === detail.definition.id ? null : item);
                      editorHeading.current?.focus();
                    }}
                  >
                    {text.editFromThis}
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || activateReason.trim().length < 3}
                      aria-label={`${item.sequence < detail.definition.sequence ? text.restore : text.activate}: ${label}`}
                      onClick={() => void activate(item.id, activateReason.trim())}
                    >
                      {item.sequence < detail.definition.sequence ? text.restore : text.activate}
                    </button>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
        {history.nextBefore !== null && (
          <p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void olderVersions()}
            >
              {text.showMore}
            </button>
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="performance-heading">
        <h2 id="performance-heading">{text.performanceHeading}</h2>
        {!performance ? (
          <p className="muted">{text.performanceNone}</p>
        ) : (
          <>
            <p className="muted">
              {fill(text.performanceAt, {
                date: formatDateTime(locale, performance.createdAt),
                charter: performance.charterVersion,
              })}
            </p>
            {performance.role ? (
              <dl className="counts">
                <div>
                  <dt>{text.deviations}</dt>
                  <dd>{formatNumber(locale, performance.role.deviations)}</dd>
                </div>
                <div>
                  <dt>{text.invocations}</dt>
                  <dd>{formatNumber(locale, performance.role.invocations)}</dd>
                </div>
                <div>
                  <dt>{text.cost}</dt>
                  <dd>{formatNumber(locale, performance.role.costUsd)}</dd>
                </div>
                <div>
                  <dt>{text.latency}</dt>
                  <dd>
                    {performance.role.avgLatencyMs === null
                      ? '—'
                      : formatNumber(locale, performance.role.avgLatencyMs)}
                  </dd>
                </div>
                <div>
                  <dt>{text.retries}</dt>
                  <dd>{formatNumber(locale, performance.role.retries)}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">{text.noRoleData}</p>
            )}
            {performance.deviations.length > 0 && (
              <ul className="plain-list">
                {performance.deviations.map((deviation) => (
                  <li key={deviation.rule}>
                    <span className="badge">{deviation.severity}</span>{' '}
                    <span dir="auto">{deviation.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link href={`/${locale}/brain` as Route}>{text.fullReport}</Link>
            </p>
          </>
        )}
      </section>

      <section className="card stack" aria-labelledby="outputs-heading">
        <h2 id="outputs-heading">{text.outputsHeading}</h2>
        <p className="muted">{text.outputsHelp}</p>
        {!outputs ? (
          <p role="status">{text.loading}</p>
        ) : outputs.items.length === 0 ? (
          <p className="muted">{text.outputsNone}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">{text.outputsHeading}</caption>
              <thead>
                <tr>
                  <th scope="col">{text.outputColumns.project}</th>
                  <th scope="col">{text.outputColumns.stage}</th>
                  <th scope="col">{text.outputColumns.version}</th>
                  <th scope="col">{text.outputColumns.definition}</th>
                  <th scope="col">{text.outputColumns.date}</th>
                </tr>
              </thead>
              <tbody>
                {outputs.items.map((item) => (
                  <tr key={item.id}>
                    <td dir="auto">
                      {item.projectId ? (
                        <Link href={`/${locale}/projects/${item.projectId}` as Route}>
                          {item.projectTitle ?? item.projectId}
                        </Link>
                      ) : (
                        fill(text.reportOf, { scope: text.scopes[item.scope ?? 'workspace'] ?? '' })
                      )}
                    </td>
                    <td>{item.stage ? (text.stages[item.stage] ?? item.stage) : '—'}</td>
                    <td>
                      {item.versionNo === undefined ? '—' : formatNumber(locale, item.versionNo)}
                    </td>
                    <td>
                      {item.definitionSequence
                        ? fill(text.versionLabel, {
                            n: formatNumber(locale, item.definitionSequence),
                          })
                        : '—'}
                    </td>
                    <td>{formatDateTime(locale, item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {outputs?.nextCursor && (
          <p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void moreOutputs()}
            >
              {text.showMore}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
