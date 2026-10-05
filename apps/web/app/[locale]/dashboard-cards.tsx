'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../api-client';
import { formatDateTime, formatNumber, type Locale } from '../i18n';
import { reportMessagesFor } from '../report-messages';

interface Dashboard {
  waiting: {
    total: number;
    items: {
      id: string;
      title: string;
      projectId: string | null;
      projectTitle: string | null;
      createdAt: string;
    }[];
  };
  workflows: { active: number; waitingForHuman: number; paused: number; failed: number };
  knowledge: { pending: number; expired: number; needsRevision: number; conflicted: number };
  providers: {
    items: {
      id: string;
      name: string;
      provider: string;
      status: string;
      lastCheckedAt: string | null;
    }[];
    unhealthy: number;
    costWarnings: { projectId: string; projectTitle: string; spentUsd: number; limitUsd: number }[];
  };
  retriesNearLimit: {
    id: string;
    projectTitle: string;
    stage: string;
    attemptsUsed: number;
    attemptLimit: number;
  }[];
  usage: { invocations: number; tokens: number; costUsd: number };
  latestBrainReport: {
    id: string;
    scope: string;
    createdAt: string;
    deviations: number;
    high: number;
  } | null;
}

/** Isolated so a dollar amount keeps its own direction inside right-to-left text. */
function money(locale: Locale, value: number) {
  return (
    <bdi>
      {new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 4,
      }).format(value)}
    </bdi>
  );
}

/** Live dashboard cards (REP-001, docs/01-product/05-backoffice-ux.md §3). */
export function DashboardCards({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const content = reportMessagesFor(locale);
  const text = content.dashboard;
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<{ dashboard: Dashboard }>(`/workspaces/${workspaceId}/dashboard`, controller.signal)
      .then((body) => setData(body.dashboard))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workspaceId]);

  if (failed) return <p className="notice error">{content.loadFailed}</p>;
  if (!data) return <p role="status">{content.loading}</p>;

  const number = (value: number) => formatNumber(locale, value);
  const counts = (items: [string, number, string?][]) => (
    <dl className="counts">
      {items.map(([label, value, href]) => (
        <div key={label}>
          <dt>{href ? <Link href={href as Route}>{label}</Link> : label}</dt>
          <dd>{number(value)}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="grid dashboard-grid">
      <section className="card" aria-labelledby="waiting-title">
        <h2 id="waiting-title">
          {text.waiting} <span className="badge">{number(data.waiting.total)}</span>
        </h2>
        {data.waiting.items.length === 0 ? (
          <p className="muted">{text.waitingEmpty}</p>
        ) : (
          <ul className="plain-list">
            {data.waiting.items.map((item) => (
              <li key={item.id}>
                {item.projectId ? (
                  <Link href={`/${locale}/projects/${item.projectId}?tab=workflow` as Route}>
                    <strong>{item.title}</strong>
                  </Link>
                ) : (
                  <strong>{item.title}</strong>
                )}
                {item.projectTitle && <span className="muted"> — {item.projectTitle}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="workflows-title">
        <h2 id="workflows-title">{text.workflows}</h2>
        {counts([
          [text.active, data.workflows.active],
          [text.waitingForHuman, data.workflows.waitingForHuman],
          [text.paused, data.workflows.paused],
          [text.failed, data.workflows.failed],
        ])}
      </section>

      <section className="card" aria-labelledby="knowledge-title">
        <h2 id="knowledge-title">
          <Link href={`/${locale}/knowledge` as Route}>{text.knowledge}</Link>
        </h2>
        {counts([
          [text.pending, data.knowledge.pending, `/${locale}/knowledge?status=pending`],
          [text.expired, data.knowledge.expired, `/${locale}/knowledge?status=expired`],
          [
            text.needsRevision,
            data.knowledge.needsRevision,
            `/${locale}/knowledge?status=needs_revision`,
          ],
          [text.conflicted, data.knowledge.conflicted, `/${locale}/knowledge?tab=conflicts`],
        ])}
      </section>

      <section className="card" aria-labelledby="providers-title">
        <h2 id="providers-title">{text.providers}</h2>
        {data.providers.items.length === 0 ? (
          <p className="muted">{text.providersEmpty}</p>
        ) : (
          <ul className="plain-list">
            {data.providers.items.map((item) => (
              <li key={item.id}>
                {item.name}{' '}
                <span className={`badge state-${item.status}`}>
                  {text.providerStatuses[item.status] ?? item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.providers.costWarnings.map((warning) => (
          <p key={warning.projectId} className="notice error">
            {text.costWarning}: {warning.projectTitle} ({money(locale, warning.spentUsd)} /{' '}
            {money(locale, warning.limitUsd)})
          </p>
        ))}
      </section>

      <section className="card" aria-labelledby="retries-title">
        <h2 id="retries-title">{text.retries}</h2>
        {data.retriesNearLimit.length === 0 ? (
          <p className="muted">{text.retriesEmpty}</p>
        ) : (
          <ul className="plain-list">
            {data.retriesNearLimit.map((item) => (
              <li key={item.id}>
                {item.projectTitle} · {item.stage}: {number(item.attemptsUsed)}/
                {number(item.attemptLimit)} {text.attempts}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="usage-title">
        <h2 id="usage-title">{text.usage}</h2>
        {counts([
          [text.invocations, data.usage.invocations],
          [text.tokens, data.usage.tokens],
        ])}
        <p>
          {text.cost}: <strong>{money(locale, data.usage.costUsd)}</strong>
        </p>
      </section>

      <section className="card" aria-labelledby="brain-title">
        <h2 id="brain-title">{text.brain}</h2>
        {data.latestBrainReport ? (
          <p>
            <Link href={`/${locale}/brain?report=${data.latestBrainReport.id}` as Route}>
              {formatDateTime(locale, data.latestBrainReport.createdAt)}
            </Link>{' '}
            — {number(data.latestBrainReport.deviations)} {text.deviations},{' '}
            {number(data.latestBrainReport.high)} {text.high}
          </p>
        ) : (
          <p className="muted">{text.brainEmpty}</p>
        )}
      </section>

      <section className="card" aria-labelledby="actions-title">
        <h2 id="actions-title">{text.quickActions}</h2>
        <ul className="plain-list">
          <li>
            <Link href={`/${locale}/projects/new` as Route}>{text.newProject}</Link>
          </li>
          <li>
            <Link href={`/${locale}/topics` as Route}>{text.newTopic}</Link>
          </li>
          <li>
            <Link href={`/${locale}/projects` as Route}>{text.openProjects}</Link>
          </li>
          <li>
            <Link href={`/${locale}/brain` as Route}>{text.openBrain}</Link>
          </li>
          <li>
            <Link href={`/${locale}/audit` as Route}>{text.openAudit}</Link>
          </li>
          <li>
            <Link href={`/${locale}/costs` as Route}>{text.openCosts}</Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
