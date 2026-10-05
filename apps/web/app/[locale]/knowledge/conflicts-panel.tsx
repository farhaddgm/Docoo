'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import { Badge } from './knowledge-common';
import { knowledgeMessages, type KnowledgeText } from './knowledge-messages';
import { MIN_RESOLUTION_LENGTH, type Conflict } from './knowledge-types';
import { parseConflictAnalysis } from './reasons';

function analysisText(text: KnowledgeText, locale: Locale, raw: string): string {
  const analysis = parseConflictAnalysis(raw);
  switch (analysis.kind) {
    case 'numeric':
      return fill(text.conflictAnalysis.numeric, {
        similarity: formatNumber(locale, analysis.similarity),
        // Figures keep their own left-to-right order inside right-to-left text.
        first: `\u2066${analysis.first}\u2069`,
        second: `\u2066${analysis.second}\u2069`,
      });
    case 'negation':
      return fill(text.conflictAnalysis.negation, {
        similarity: formatNumber(locale, analysis.similarity),
      });
    default:
      return analysis.raw;
  }
}

/** KNO-005: both claims side by side, and a way to record why both can stay. */
export function ConflictCard({
  locale,
  workspaceId,
  conflict,
  onResolved,
}: {
  locale: Locale;
  workspaceId: string;
  conflict: Conflict;
  onResolved: () => void;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const [resolution, setResolution] = useState('');
  const ready = resolution.trim().length >= MIN_RESOLUTION_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    const done = await run(async () => {
      await apiSend(
        'POST',
        `/workspaces/${workspaceId}/knowledge-conflicts/${conflict.id}/resolve`,
        {
          resolution: resolution.trim(),
        },
      );
    }, '');
    if (done) onResolved();
  }

  const sides = [
    { label: text.claimA, side: conflict.claimA },
    { label: text.claimB, side: conflict.claimB },
  ];
  return (
    <li className="card stack">
      <p>
        <Badge tone={conflict.severity === 'high' ? 'danger' : 'warn'}>
          {text.conflictTypes[conflict.conflictType] ?? conflict.conflictType}
        </Badge>
        <Badge tone="neutral">{text.severities[conflict.severity] ?? conflict.severity}</Badge>{' '}
        <span className="muted">{formatDateTime(locale, conflict.createdAt)}</span>
      </p>
      <p dir="auto">{analysisText(text, locale, conflict.analysis)}</p>
      <div className="conflict-sides">
        {sides.map(({ label, side }) => (
          <blockquote key={side.id} className="conflict-side">
            <strong>{label}</strong>
            <p dir="auto">{side.text}</p>
            <small className="muted" dir="auto">
              <Link href={`/${locale}/knowledge/${side.knowledgeId}` as Route}>
                {fill(text.fromDocument, { title: side.title })}
              </Link>
            </small>
          </blockquote>
        ))}
      </div>
      {conflict.status === 'resolved' ? (
        <p className="notice ok" role="status" dir="auto">
          {fill(text.resolvedOn, {
            date: conflict.resolvedAt ? formatDateTime(locale, conflict.resolvedAt) : '—',
            resolution: conflict.resolution ?? '',
          })}
        </p>
      ) : (
        <form className="field-stack" onSubmit={submit}>
          <Notice notice={notice} />
          <label htmlFor={`${id}-resolution`}>{text.resolveLabel}</label>
          <textarea
            id={`${id}-resolution`}
            dir="auto"
            rows={3}
            value={resolution}
            maxLength={2000}
            aria-describedby={`${id}-help`}
            onChange={(event) => setResolution(event.target.value)}
          />
          <small id={`${id}-help`} className="muted">
            {text.resolveHelp}
          </small>
          <p>
            <button type="submit" className="primary-button" disabled={busy || !ready}>
              {text.resolveSubmit}
            </button>
          </p>
        </form>
      )}
    </li>
  );
}

/** The conflicts between knowledge in use, open ones first (UX §8, FR-KNO-009). */
export function ConflictsPanel({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [items, setItems] = useState<Conflict[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The confirmation lives here, not in the card: the card leaves the open list at once.
  const [justResolved, setJustResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await apiGet<{ items: Conflict[] }>(
        `/workspaces/${workspaceId}/knowledge-conflicts${query({ status, limit: '100' })}`,
      );
      setItems(result.items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [workspaceId, status]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.conflictsHeading}</h2>
      <p className="muted">{text.conflictsHelp}</p>
      <div className="toolbar" role="group" aria-label={text.conflictsStatus}>
        {(['open', 'resolved'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className="secondary-button"
            aria-pressed={status === item}
            onClick={() => {
              setStatus(item);
              setJustResolved(false);
            }}
          >
            {item === 'open' ? text.conflictOpen : text.conflictResolved}
          </button>
        ))}
      </div>
      {justResolved && (
        <p className="notice ok" role="status">
          {text.resolved}
        </p>
      )}
      {failed && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {!failed && items === null && <p role="status">{text.loading}</p>}
      {items?.length === 0 && (
        <p className="muted" role="status">
          {text.conflictsEmpty}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="plain-list conflict-list">
          {items.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              locale={locale}
              workspaceId={workspaceId}
              conflict={conflict}
              onResolved={() => {
                setJustResolved(true);
                void load();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
