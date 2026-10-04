'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { solutionMessages } from './solution-messages';

interface Criterion {
  key: string;
  label: string;
  weight: number;
  enabled: boolean;
}

interface CriterionScore {
  key: string;
  label: string;
  raw: number;
  max: number;
  weight: number;
  weighted: number;
  explanation: string;
}

interface Solution {
  id: string;
  ordinal: number;
  title: string;
  summary: string;
  assumptions: string[];
  evidence: string[];
  plan: string[];
  risks: string[];
  score: { criteria: CriterionScore[]; total: number };
  selectedPriority: number | null;
}

interface SolutionSet {
  setId: string | null;
  createdAt?: string;
  criteria: { versionId: string | null; versionNo: number; criteria: Criterion[] };
  items: Solution[];
}

const sum = (criteria: Criterion[]) =>
  criteria.filter((item) => item.enabled).reduce((total, item) => total + item.weight, 0);

/** SOL-001..003: generate scored solutions, tune the criteria and select by priority. */
export function SolutionsPanel({
  locale,
  workspaceId,
  projectId,
  readOnly,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const text = solutionMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [set, setSet] = useState<SolutionSet | null>(null);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState('');
  const [draft, setDraft] = useState<Criterion[]>([]);
  const [criteriaReason, setCriteriaReason] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [selectionReason, setSelectionReason] = useState('');
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    const { solutionSet } = await apiGet<{ solutionSet: SolutionSet }>(`${base}/solutions`);
    setSet(solutionSet);
    setDraft(solutionSet.criteria.criteria.map((item) => ({ ...item })));
    setChosen(
      solutionSet.items
        .filter((item) => item.selectedPriority !== null)
        .sort((a, b) => (a.selectedPriority ?? 0) - (b.selectedPriority ?? 0))
        .map((item) => item.id),
    );
  }, [base]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  if (failed && !set) {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (!set) return <p role="status">{common.loading}</p>;

  const total = sum(draft);
  const criteriaChanged = JSON.stringify(draft) !== JSON.stringify(set.criteria.criteria);
  const byId = new Map(set.items.map((item) => [item.id, item]));

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requested = Number(count);
    void run(async () => {
      await apiSend(
        'POST',
        `${base}/solutions/generate`,
        count.trim() && Number.isInteger(requested) ? { count: requested } : {},
      );
      await load();
    }, text.done.generated);
  }

  function saveCriteria(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend('PUT', `${base}/solution-criteria`, {
        criteria: draft.map((item) => ({ ...item, label: item.label.trim() })),
        reason: criteriaReason.trim(),
      });
      setCriteriaReason('');
      await load();
    }, text.done.criteria);
  }

  function select(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = selectionReason.trim();
    void run(async () => {
      await apiSend('POST', `${base}/solution-selections`, {
        solutionIds: chosen,
        ...(reason ? { reason } : {}),
      });
      setSelectionReason('');
      await load();
      onChanged();
    }, text.done.selected);
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= chosen.length) return;
    const next = [...chosen];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setChosen(next);
  }

  const patch = (key: string, change: Partial<Criterion>) =>
    setDraft((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));

  return (
    <div className="stack">
      <Notice notice={notice} />

      {!readOnly && (
        <form
          className="card filter-form"
          onSubmit={generate}
          aria-labelledby="generate-title"
          aria-busy={busy}
        >
          <h2 id="generate-title">{text.generateTitle}</h2>
          <p className="muted">{text.generateHelp}</p>
          <div className="filter-grid">
            <label htmlFor="solution-count">{text.count}</label>
            <input
              id="solution-count"
              type="number"
              inputMode="numeric"
              min={2}
              max={20}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              aria-describedby="solution-count-help"
            />
            <span />
            <p id="solution-count-help" className="muted">
              {text.countHelp}
            </p>
          </div>
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? text.generating : text.generate}
            </button>
            <Link className="secondary-button link-button" href={`/${locale}/providers` as Route}>
              {text.openProviders}
            </Link>
          </div>
        </form>
      )}

      <form
        className="card filter-form"
        onSubmit={saveCriteria}
        aria-labelledby="criteria-title"
        aria-busy={busy}
      >
        <h2 id="criteria-title">{text.criteriaTitle}</h2>
        <p className="muted">
          {text.criteriaHelp}{' '}
          {text.criteriaVersion.replace('{n}', formatNumber(locale, set.criteria.versionNo))}
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="criteria-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{text.enabled}</th>
                <th scope="col">{text.criterion}</th>
                <th scope="col">{text.weight}</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((item) => (
                <tr key={item.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      disabled={readOnly}
                      aria-label={`${text.enabled}: ${item.label}`}
                      onChange={(event) => patch(item.key, { enabled: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className="inline-input"
                      dir="auto"
                      value={item.label}
                      maxLength={200}
                      disabled={readOnly}
                      aria-label={`${text.criterion} (${item.key})`}
                      onChange={(event) => patch(item.key, { label: event.target.value })}
                      required
                    />
                  </td>
                  <td>
                    <input
                      className="inline-input narrow"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={item.weight}
                      disabled={readOnly}
                      aria-label={`${text.weight}: ${item.label}`}
                      onChange={(event) =>
                        patch(item.key, { weight: Math.round(Number(event.target.value)) })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {text.total}
                </th>
                <td>
                  <span className={`badge ${total === 100 ? 'state-passed' : 'state-failed'}`}>
                    {formatNumber(locale, total)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!readOnly && (
          <>
            <div className="filter-grid">
              <label htmlFor="criteria-reason">{text.criteriaReason}</label>
              <input
                id="criteria-reason"
                value={criteriaReason}
                minLength={3}
                maxLength={1000}
                onChange={(event) => setCriteriaReason(event.target.value)}
                autoComplete="off"
                required={criteriaChanged}
              />
            </div>
            <div className="toolbar">
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !criteriaChanged || total !== 100}
              >
                {text.saveCriteria}
              </button>
            </div>
          </>
        )}
      </form>

      <section className="stack" aria-labelledby="solutions-title">
        <div className="card">
          <h2 id="solutions-title">{text.listTitle}</h2>
          {set.items.length === 0 ? (
            <p className="muted">{text.none}</p>
          ) : (
            set.createdAt && (
              <p className="muted">
                {text.generatedAt.replace('{time}', formatDateTime(locale, set.createdAt))}
              </p>
            )
          )}
        </div>
        {set.items.map((solution) => (
          <article key={solution.id} className="card" aria-labelledby={`solution-${solution.id}`}>
            <div className="toolbar spread">
              <h3 id={`solution-${solution.id}`} dir="auto">
                {formatNumber(locale, solution.ordinal)}. {solution.title}
              </h3>
              <p>
                {text.score}:{' '}
                <span className="badge">
                  {formatNumber(locale, solution.score.total)} {text.outOf}
                </span>
                {solution.selectedPriority !== null && (
                  <span className="badge state-passed">
                    {text.selectedAs.replace(
                      '{n}',
                      formatNumber(locale, solution.selectedPriority),
                    )}
                  </span>
                )}
              </p>
            </div>
            <p dir="auto">{solution.summary}</p>
            <details>
              <summary>{text.assumptions}</summary>
              <List items={solution.assumptions} />
            </details>
            <details>
              <summary>{text.evidence}</summary>
              <List items={solution.evidence} />
            </details>
            <details>
              <summary>{text.plan}</summary>
              <List items={solution.plan} ordered />
            </details>
            <details>
              <summary>{text.risks}</summary>
              <List items={solution.risks} />
            </details>
            <details>
              <summary>{text.scoreDetail}</summary>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={`${text.scoreDetail}: ${solution.title}`}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{text.criterion}</th>
                      <th scope="col">{text.raw}</th>
                      <th scope="col">{text.weight}</th>
                      <th scope="col">{text.weighted}</th>
                      <th scope="col">{text.calculation}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solution.score.criteria.map((row) => (
                      <tr key={row.key}>
                        <th scope="row" dir="auto">
                          {row.label}
                        </th>
                        <td>
                          {formatNumber(locale, row.raw)}/{formatNumber(locale, row.max)}
                        </td>
                        <td>{formatNumber(locale, row.weight)}</td>
                        <td>{formatNumber(locale, row.weighted)}</td>
                        <td dir="ltr">{row.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {!readOnly && (
              <div className="toolbar">
                {chosen.includes(solution.id) ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setChosen(chosen.filter((id) => id !== solution.id))}
                  >
                    {text.removeFromSelection}
                    <span className="visually-hidden">: {solution.title}</span>
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setChosen([...chosen, solution.id])}
                  >
                    {text.addToSelection}
                    <span className="visually-hidden">: {solution.title}</span>
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </section>

      {set.items.length > 0 && !readOnly && (
        <form
          className="card filter-form"
          onSubmit={select}
          aria-labelledby="selection-title"
          aria-busy={busy}
        >
          <h2 id="selection-title">{text.selectionTitle}</h2>
          <p className="muted">{text.selectionHelp}</p>
          {chosen.length === 0 ? (
            <p className="muted">{text.selectionEmpty}</p>
          ) : (
            <ol className="priority-list">
              {chosen.map((id, index) => {
                const solution = byId.get(id);
                if (!solution) return null;
                return (
                  <li key={id}>
                    <span className="badge" aria-hidden="true">
                      {formatNumber(locale, index + 1)}
                    </span>
                    <span className="grow" dir="auto">
                      <strong>{solution.title}</strong>
                    </span>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={index === 0}
                      aria-label={`${text.moveUp}: ${solution.title}`}
                      onClick={() => move(index, -1)}
                    >
                      {text.moveUp}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={index === chosen.length - 1}
                      aria-label={`${text.moveDown}: ${solution.title}`}
                      onClick={() => move(index, 1)}
                    >
                      {text.moveDown}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="filter-grid">
            <label htmlFor="selection-reason">{text.selectionReason}</label>
            <input
              id="selection-reason"
              value={selectionReason}
              minLength={3}
              maxLength={1000}
              onChange={(event) => setSelectionReason(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy || chosen.length === 0}>
              {busy ? text.working : text.select}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function List({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className="output-list">
      {items.map((item, index) => (
        <li key={index} dir="auto">
          {item}
        </li>
      ))}
    </Tag>
  );
}
