'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { SignedIn } from '../signed-in';
import { agentMessages, fill } from './agent-messages';
import type { RoleSummary } from './agent-types';

export function AgentsPage({ locale }: { locale: Locale }) {
  const text = agentMessages(locale);
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <Roles locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

/** FR-AGT-001: the six roles with the version each one runs with. */
function Roles({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = agentMessages(locale);
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<{ items: RoleSummary[] }>(`/workspaces/${workspaceId}/agent-roles`, controller.signal)
      .then((result) => setRoles(result.items))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workspaceId]);

  if (failed) {
    return (
      <p className="notice error" role="alert">
        {text.failed}
      </p>
    );
  }
  if (!roles) return <p role="status">{text.loading}</p>;

  return (
    <section className="card stack" aria-labelledby="agents-heading">
      <h2 id="agents-heading">{text.listCaption}</h2>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">{text.listCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{text.columns.role}</th>
              <th scope="col">{text.columns.stage}</th>
              <th scope="col">{text.columns.version}</th>
              <th scope="col">{text.columns.model}</th>
              <th scope="col">{text.columns.rules}</th>
              <th scope="col">{text.columns.tools}</th>
              <th scope="col">{text.columns.changed}</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((item) => {
              const name = text.roles[item.role].name;
              return (
                <tr key={item.role}>
                  <th scope="row">
                    <Link
                      href={`/${locale}/agents/${item.role}` as Route}
                      aria-label={fill(text.openLabel, { role: name })}
                    >
                      {name}
                    </Link>
                    <br />
                    <small className="muted">{text.roles[item.role].mission}</small>
                  </th>
                  <td>{item.stage ? (text.stages[item.stage] ?? item.stage) : text.sideRole}</td>
                  <td>
                    <span className="badge">
                      {fill(text.versionLabel, { n: formatNumber(locale, item.active.sequence) })}
                    </span>
                  </td>
                  <td dir="auto">{item.active.modelPolicy?.model ?? text.defaultModel}</td>
                  <td>
                    {formatNumber(locale, item.active.counts.principles)} /{' '}
                    {formatNumber(locale, item.active.counts.duties)}
                  </td>
                  <td>
                    {formatNumber(locale, item.active.counts.tools)} /{' '}
                    {formatNumber(locale, item.toolCeiling.length)}
                  </td>
                  <td>{formatDateTime(locale, item.active.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">{text.projectHint}</p>
    </section>
  );
}
