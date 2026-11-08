'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiGet } from '../../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../../i18n';
import { projectReportMessages } from './report-messages';
import { PanelsSkeleton } from '../../../../skeleton';

interface UsageRow {
  key: string;
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface ProjectReport {
  project: {
    id: string;
    code: string;
    title: string;
    status: string;
    currentStage: string;
    updatedAt: string;
  };
  problem: {
    initialProblem: string;
    description: string;
    expectedOutput: string;
    approvedStatement: string | null;
  };
  usage: {
    totals: Omit<UsageRow, 'key'> & { failures: number };
    byStage: UsageRow[];
    byModel: UsageRow[];
  };
  ideas: {
    items: {
      id: string;
      title: string;
      summary: string;
      score: number | null;
      selectedPriority: number | null;
    }[];
  };
  outputs: {
    inProgress: number;
    items: {
      id: string;
      title: string;
      status: string;
      versionNo: number | null;
      artifacts: { id: string; format: string; sizeBytes: number; createdAt: string }[];
    }[];
  };
}

const fill = (template: string, n: number | string) => template.replace('{n}', String(n));
const totalTokens = (row: Omit<UsageRow, 'key' | 'invocations' | 'costUsd'>) =>
  row.inputTokens + row.outputTokens + row.reasoningTokens;

/** The summary report of one project: problem, tokens used, ideas made and final outputs. */
export function ProjectReportScreen({
  locale,
  projectId,
  workspaceId,
}: {
  locale: Locale;
  projectId: string;
  workspaceId: string;
}) {
  const text = projectReportMessages(locale);
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    apiGet<{ report: ProjectReport }>(`/workspaces/${workspaceId}/projects/${projectId}/report`)
      .then((result) => !cancelled && setReport(result.report))
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(
            failure instanceof ApiError && failure.status === 404 ? text.notFound : text.loadFailed,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, projectId, text.notFound, text.loadFailed]);

  const dir = textDir(locale);
  const number = (value: number) => formatNumber(locale, value);
  const money = (value: number) =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 6,
    }).format(value);

  const nav = (
    <div className="toolbar">
      <Link className="secondary-button link-button" href={`/${locale}/projects` as Route}>
        {text.back}
      </Link>
      <Link
        className="secondary-button link-button"
        href={`/${locale}/projects/${projectId}` as Route}
      >
        {text.openProject}
      </Link>
    </div>
  );

  if (error)
    return (
      <div className="stack">
        {nav}
        <p className="notice error" role="alert">
          {error}
        </p>
      </div>
    );
  if (!report)
    return (
      <div className="stack">
        {nav}
        <PanelsSkeleton label={text.loading} />
      </div>
    );

  const { project, problem, usage, ideas, outputs } = report;
  const usageTable = (rows: UsageRow[], heading: string, label: (key: string) => string) => (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={heading}>
      <table>
        <thead>
          <tr>
            <th scope="col">{heading}</th>
            <th scope="col">{text.tokens.calls}</th>
            <th scope="col">{text.tokens.input}</th>
            <th scope="col">{text.tokens.output}</th>
            <th scope="col">{text.tokens.reasoning}</th>
            <th scope="col">{text.tokens.cost}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" dir="auto">
                {label(row.key)}
              </th>
              <td>{number(row.invocations)}</td>
              <td>{number(row.inputTokens)}</td>
              <td>{number(row.outputTokens)}</td>
              <td>{number(row.reasoningTokens)}</td>
              <td>{money(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack">
      {nav}
      <section className="card" aria-labelledby="report-project">
        <h2 id="report-project" dir={dir}>
          <span dir="ltr">{project.code}</span> — {project.title}
        </h2>
        <p className="muted">
          {text.status}: {text.statuses[project.status] ?? project.status} · {text.stage}:{' '}
          {text.stages[project.currentStage] ?? project.currentStage} · {text.updated}:{' '}
          {formatDateTime(locale, project.updatedAt)}
        </p>
      </section>

      <section className="card" aria-labelledby="report-problem">
        <h2 id="report-problem">{text.problem.title}</h2>
        {problem.approvedStatement ? (
          <>
            <h3>{text.problem.approved}</h3>
            <p dir={dir}>{problem.approvedStatement}</p>
          </>
        ) : (
          <p className="muted">{text.problem.notApproved}</p>
        )}
        <h3>{text.problem.initial}</h3>
        <p dir={dir}>{problem.initialProblem}</p>
        {problem.description && (
          <>
            <h3>{text.problem.description}</h3>
            <p dir={dir}>{problem.description}</p>
          </>
        )}
        <h3>{text.problem.expected}</h3>
        <p dir={dir}>{problem.expectedOutput || text.problem.none}</p>
      </section>

      <section className="card" aria-labelledby="report-tokens">
        <h2 id="report-tokens">{text.tokens.title}</h2>
        {usage.totals.invocations === 0 ? (
          <p className="muted">{text.tokens.empty}</p>
        ) : (
          <>
            <dl className="report-totals">
              {(
                [
                  [text.tokens.total, number(totalTokens(usage.totals))],
                  [text.tokens.input, number(usage.totals.inputTokens)],
                  [text.tokens.output, number(usage.totals.outputTokens)],
                  [text.tokens.reasoning, number(usage.totals.reasoningTokens)],
                  [text.tokens.calls, number(usage.totals.invocations)],
                  [text.tokens.failures, number(usage.totals.failures)],
                  [text.tokens.cost, money(usage.totals.costUsd)],
                ] as const
              ).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h3>{text.tokens.byStage}</h3>
            {usageTable(usage.byStage, text.tokens.stage, (key) => text.stages[key] ?? key)}
            <h3>{text.tokens.byModel}</h3>
            {usageTable(usage.byModel, text.tokens.model, (key) => key)}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="report-ideas">
        <h2 id="report-ideas">{text.ideas.title}</h2>
        {ideas.items.length === 0 ? (
          <p className="muted">{text.ideas.empty}</p>
        ) : (
          <>
            <p className="muted">{fill(text.ideas.count, number(ideas.items.length))}</p>
            <ol className="report-list">
              {ideas.items.map((idea) => (
                <li key={idea.id}>
                  <strong dir={dir}>{idea.title}</strong>{' '}
                  {idea.selectedPriority !== null && (
                    <span className="badge state-active">
                      {fill(text.ideas.selected, number(idea.selectedPriority))}
                    </span>
                  )}{' '}
                  {idea.score !== null && (
                    <span className="muted">{fill(text.ideas.score, number(idea.score))}</span>
                  )}
                  <p dir={dir}>{idea.summary}</p>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="report-outputs">
        <h2 id="report-outputs">{text.outputs.title}</h2>
        {outputs.items.length === 0 ? (
          <p className="muted">{text.outputs.empty}</p>
        ) : (
          <ul className="report-list">
            {outputs.items.map((output) => (
              <li key={output.id}>
                <strong dir={dir}>{output.title}</strong>{' '}
                <span className="badge state-completed">
                  {text.outputs.statuses[output.status] ?? output.status}
                </span>{' '}
                {output.versionNo !== null && (
                  <span className="muted">
                    {fill(text.outputs.version, number(output.versionNo))}
                  </span>
                )}
                <p className="muted">
                  {text.outputs.files}:{' '}
                  {output.artifacts.length === 0
                    ? text.outputs.noFiles
                    : output.artifacts
                        .map(
                          (file) =>
                            `${file.format.toUpperCase()} (${formatDateTime(locale, file.createdAt)})`,
                        )
                        .join('، ')}
                </p>
              </li>
            ))}
          </ul>
        )}
        {outputs.inProgress > 0 && (
          <p className="muted">{fill(text.outputs.inProgress, number(outputs.inProgress))}</p>
        )}
      </section>
    </div>
  );
}
