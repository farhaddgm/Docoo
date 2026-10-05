'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import Link from 'next/link';
import type { Route } from 'next';

import { apiGet, dayBoundary, query } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { reportMessagesFor } from '../../report-messages';
import { SignedIn } from '../signed-in';

type GroupBy = 'stage' | 'project' | 'day' | 'model';

interface Row {
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failures: number;
  /** Succeeded calls estimated with the high fallback because their model has no price. */
  unpricedInvocations?: number;
  avgLatencyMs: number | null;
}

interface Usage {
  period: { from: string; to: string };
  totals: Row;
  groups: (Row & { key: string; label: string })[];
}

export function CostReport({ locale }: { locale: Locale }) {
  const text = reportMessagesFor(locale).costs;
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <Report locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

/** REP-004: tokens and estimated cost per stage, project, day or model in a period. */
function Report({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const content = reportMessagesFor(locale);
  const text = content.costs;
  const audit = content.audit;
  const [groupBy, setGroupBy] = useState<GroupBy>('stage');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(
    async (input: { groupBy: GroupBy; from: string; to: string }) => {
      setError('');
      try {
        const search = query({
          groupBy: input.groupBy,
          from: dayBoundary(input.from),
          to: dayBoundary(input.to, true),
        });
        setUsage(
          (await apiGet<{ usage: Usage }>(`/workspaces/${workspaceId}/reports/usage${search}`))
            .usage,
        );
      } catch {
        setError(audit.invalid);
      }
    },
    [audit.invalid, workspaceId],
  );

  useEffect(() => {
    void load({ groupBy: 'stage', from: '', to: '' });
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load({ groupBy, from, to });
  }

  const money = (value: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 6,
    }).format(value);
  const cells = (row: Row) => (
    <>
      <td>{formatNumber(locale, row.invocations)}</td>
      <td>{formatNumber(locale, row.inputTokens)}</td>
      <td>{formatNumber(locale, row.outputTokens)}</td>
      <td>{money(row.costUsd)}</td>
      <td>{formatNumber(locale, row.failures)}</td>
      <td>{row.avgLatencyMs === null ? '—' : formatNumber(locale, row.avgLatencyMs)}</td>
    </>
  );

  return (
    <div className="stack">
      <form className="card filter-form" onSubmit={submit} aria-labelledby="period-title">
        <h2 id="period-title">{content.audit.filters}</h2>
        <div className="filter-grid">
          <label htmlFor="cost-group">{text.groupBy}</label>
          <select
            id="cost-group"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
          >
            <option value="stage">{text.byStage}</option>
            <option value="project">{text.byProject}</option>
            <option value="day">{text.byDay}</option>
            <option value="model">{text.byModel}</option>
          </select>
          <label htmlFor="cost-from">{audit.from}</label>
          <input
            id="cost-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <label htmlFor="cost-to">{audit.to}</label>
          <input
            id="cost-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit">
            {text.show}
          </button>
        </div>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="card" aria-labelledby="usage-title">
        <h2 id="usage-title">{text.title}</h2>
        <p className="muted">{text.estimate}</p>
        {(usage?.totals.unpricedInvocations ?? 0) > 0 && usage && (
          <div className="notice warn" role="status">
            <p>
              {fill(text.unpriced, {
                n: formatNumber(locale, usage.totals.unpricedInvocations ?? 0),
              })}{' '}
              <Link href={`/${locale}/providers` as Route}>{text.setPrices}</Link>
            </p>
          </div>
        )}
        {usage === null ? (
          <p role="status">{content.loading}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="usage-title">
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.group}</th>
                  <th scope="col">{content.dashboard.invocations}</th>
                  <th scope="col">{text.inputTokens}</th>
                  <th scope="col">{text.outputTokens}</th>
                  <th scope="col">{content.dashboard.cost}</th>
                  <th scope="col">{text.failures}</th>
                  <th scope="col">{text.latency}</th>
                </tr>
              </thead>
              <tbody>
                {usage.groups.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" dir="ltr">
                      {row.label}
                    </th>
                    {cells(row)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{text.total}</th>
                  {cells(usage.totals)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
