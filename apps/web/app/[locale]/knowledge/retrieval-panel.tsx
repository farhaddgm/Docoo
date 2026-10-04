'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useId, useState, type FormEvent } from 'react';

import { apiSend } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import { Badge, useScopeOptions } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import { scopeRoles, type Retrieval, type ScopeRole } from './knowledge-types';

/**
 * Shows what an agent would be given for a question (KNO-007): only approved, current and valid
 * knowledge in scope, with its audit score and any conflict warning. Every run pins a snapshot.
 */
export function RetrievalPanel({
  locale,
  workspaceId,
  projectId,
}: {
  locale: Locale;
  workspaceId: string;
  /** Fixes the test to one project (a project's knowledge tab). */
  projectId?: string;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const options = useScopeOptions(workspaceId);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState('workspace');
  const [role, setRole] = useState<ScopeRole | ''>('');
  const [result, setResult] = useState<Retrieval | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    const [type, target] = scope.split(':');
    await run(async () => {
      setResult(
        await apiSend<Retrieval>('POST', `/workspaces/${workspaceId}/knowledge/retrieve`, {
          query: question.trim(),
          limit: 10,
          ...(projectId ? { projectId } : {}),
          ...(!projectId && type === 'project' ? { projectId: target } : {}),
          ...(!projectId && type === 'topic' ? { topicId: target } : {}),
          ...(role ? { role } : {}),
        }),
      );
    }, '');
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.retrievalHeading}</h2>
      <p className="muted">{text.retrievalHelp}</p>
      <form className="field-stack" onSubmit={submit}>
        <label htmlFor={`${id}-q`}>{text.retrievalQuery}</label>
        <input
          id={`${id}-q`}
          dir="auto"
          value={question}
          maxLength={2000}
          onChange={(event) => setQuestion(event.target.value)}
        />
        {!projectId && (
          <>
            <label htmlFor={`${id}-scope`}>{text.retrievalScope}</label>
            <select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="workspace">{text.retrievalWorkspaceWide}</option>
              {options?.topics.map((topic) => (
                <option key={topic.id} value={`topic:${topic.id}`}>
                  {fill(text.retrievalTopic, { title: topic.title })}
                </option>
              ))}
              {options?.projects.map((project) => (
                <option key={project.id} value={`project:${project.id}`}>
                  {fill(text.retrievalProject, { title: `${project.code} — ${project.title}` })}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor={`${id}-role`}>{text.retrievalRole}</label>
        <select
          id={`${id}-role`}
          value={role}
          onChange={(event) => setRole(event.target.value as ScopeRole | '')}
        >
          <option value="">{text.allRoles}</option>
          {scopeRoles.map((item) => (
            <option key={item} value={item}>
              {text.roleNames[item]}
            </option>
          ))}
        </select>
        <p>
          <button type="submit" className="primary-button" disabled={busy || !question.trim()}>
            {text.retrievalSubmit}
          </button>
        </p>
      </form>
      <Notice notice={notice} />

      {result && (
        <div className="stack" aria-live="polite">
          {result.results.length === 0 ? (
            <p className="muted" role="status">
              {text.retrievalNone}
            </p>
          ) : (
            <>
              <p className="muted" role="status" dir="auto">
                {fill(text.retrievalSummary, {
                  n: formatNumber(locale, result.results.length),
                  model: result.embeddingModel,
                  hash: result.hash.slice(0, 12),
                })}
              </p>
              <ol className="plain-list">
                {result.results.map((item) => (
                  <li key={item.chunkId} className="card stack">
                    <h3 dir="auto">
                      <Link href={`/${locale}/knowledge/${item.knowledgeId}` as Route}>
                        {item.title}
                      </Link>{' '}
                      <small className="muted">
                        {fill(text.versionLabel, { n: formatNumber(locale, item.versionNo) })}
                      </small>
                    </h3>
                    <p>
                      <Badge tone={item.effectiveDecision === 'approved' ? 'ok' : 'warn'}>
                        {text.retrievalEffective[item.effectiveDecision]}
                      </Badge>
                      <Badge tone="neutral">{text.confidentiality[item.confidentiality]}</Badge>{' '}
                      <small className="muted">
                        {fill(text.retrievalScore, { score: formatNumber(locale, item.score) })}
                        {item.auditScore !== null &&
                          ` · ${fill(text.retrievalAudit, {
                            score: formatNumber(locale, Math.round(item.auditScore)),
                          })}`}
                        {' · '}
                        {fill(text.retrievalRank, {
                          lexical:
                            item.lexicalRank === null
                              ? text.retrievalNoRank
                              : formatNumber(locale, item.lexicalRank),
                          vector:
                            item.vectorRank === null
                              ? text.retrievalNoRank
                              : formatNumber(locale, item.vectorRank),
                        })}
                      </small>
                    </p>
                    <p dir="auto" className="retrieved-text">
                      {item.text}
                    </p>
                    {item.conflictWarnings.length > 0 && (
                      <ul className="plain-list">
                        {item.conflictWarnings.map((warning) => (
                          <li key={warning.conflictId} className="highlight" dir="auto">
                            {fill(text.retrievalWarning, {
                              type:
                                text.conflictTypes[warning.conflictType] ?? warning.conflictType,
                              severity: text.severities[warning.severity] ?? warning.severity,
                              text: warning.conflictingClaim.text,
                            })}{' '}
                            <Link
                              href={
                                `/${locale}/knowledge/${warning.conflictingClaim.knowledgeId}` as Route
                              }
                            >
                              {text.open}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
