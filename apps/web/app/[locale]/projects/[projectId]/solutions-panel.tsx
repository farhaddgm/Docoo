'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { solutionMessages } from './solution-messages';
import { SensitivityPanel } from './sensitivity-panel';
import { FieldLabel, SectionTitle } from '../../../info-tip';

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
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<
    {
      id: string;
      actorName: string | null;
      recordedAt: string;
      reason: string;
      snapshot: {
        selected: { solutionId: string; priority: number; ordinal: number }[];
        rejected: { solutionId: string; reason: string; ordinal: number }[];
      };
    }[]
  >([]);
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
    const journal = await apiGet<{ decisions: typeof decisions }>(`${base}/solution-decisions`);
    setDecisions(journal.decisions);
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
      await apiSend('POST', `${base}/solution-decisions`, {
        setId: set?.setId,
        criteriaVersionId: set?.criteria.versionId,
        solutionIds: chosen,
        reason,
        rejected: set?.items
          .filter((s) => !chosen.includes(s.id))
          .map((s) => ({ solutionId: s.id, reason: (rejectionReasons[s.id] ?? '').trim() })),
      });
      setSelectionReason('');
      setRejectionReasons({});
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
          data-write-action
          className="card filter-form"
          onSubmit={generate}
          aria-labelledby="generate-title"
          aria-busy={busy}
        >
          <SectionTitle id="generate-title" help={text.generateHelp}>
            {text.generateTitle}
          </SectionTitle>
          <div className="filter-grid">
            <FieldLabel htmlFor="solution-count" help={text.countHelp} helpId="solution-count-help">
              {text.count}
            </FieldLabel>
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
        data-write-action
        className="card filter-form"
        onSubmit={saveCriteria}
        aria-labelledby="criteria-title"
        aria-busy={busy}
      >
        <SectionTitle id="criteria-title" help={text.criteriaHelp}>
          {text.criteriaTitle}
        </SectionTitle>
        <p className="muted">
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
                      dir={textDir(locale)}
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
              <h3 id={`solution-${solution.id}`} dir={textDir(locale)}>
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
            <p dir={textDir(locale)}>{solution.summary}</p>
            <details>
              <summary>{text.assumptions}</summary>
              <List locale={locale} items={solution.assumptions} />
            </details>
            <details>
              <summary>{text.evidence}</summary>
              <List locale={locale} items={solution.evidence} />
            </details>
            <details>
              <summary>{text.plan}</summary>
              <List locale={locale} items={solution.plan} ordered />
            </details>
            <details>
              <summary>{text.risks}</summary>
              <List locale={locale} items={solution.risks} />
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
                        <th scope="row" dir={textDir(locale)}>
                          {row.label}
                        </th>
                        <td>
                          {formatNumber(locale, row.raw)}/{formatNumber(locale, row.max)}
                        </td>
                        <td>{formatNumber(locale, row.weight)}</td>
                        <td>{formatNumber(locale, row.weighted)}</td>
                        <td dir={textDir(locale)}>{row.explanation}</td>
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

      {set.setId && set.items.length >= 2 && (
        <SensitivityPanel
          key={`${set.setId}-${set.criteria.versionId ?? 'default'}`}
          locale={locale}
          base={base}
          setId={set.setId}
          criteriaVersionId={set.criteria.versionId}
          criteria={set.criteria.criteria}
          alternatives={set.items}
        />
      )}

      {set.items.length > 0 && !readOnly && (
        <form
          data-write-action
          className="card filter-form"
          onSubmit={select}
          aria-labelledby="selection-title"
          aria-busy={busy}
        >
          <SectionTitle id="selection-title" help={text.selectionHelp}>
            {text.selectionTitle}
          </SectionTitle>
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
                    <span className="grow" dir={textDir(locale)}>
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
              required
            />
          </div>
          {set.items
            .filter((s) => !chosen.includes(s.id))
            .map((s) => (
              <div className="filter-grid" key={s.id}>
                <label htmlFor={`reject-${s.id}`}>
                  {locale === 'fa' ? 'دلیل رد گزینه' : 'Reason for rejecting'}: {s.title}
                </label>
                <input
                  id={`reject-${s.id}`}
                  value={rejectionReasons[s.id] ?? ''}
                  required
                  minLength={3}
                  maxLength={1000}
                  dir={textDir(locale)}
                  onChange={(event) =>
                    setRejectionReasons((previous) => ({ ...previous, [s.id]: event.target.value }))
                  }
                />
              </div>
            ))}
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy || chosen.length === 0}>
              {busy ? text.working : text.select}
            </button>
          </div>
        </form>
      )}
      <section className="card stack" aria-labelledby="decision-journal-title">
        <h2 id="decision-journal-title">{locale === 'fa' ? 'دفتر تصمیم' : 'Decision journal'}</h2>
        {decisions.length === 0 && (
          <p className="muted">
            {locale === 'fa'
              ? 'هنوز تصمیم مستدلی ثبت نشده است.'
              : 'No reasoned decision has been recorded yet.'}
          </p>
        )}
        {decisions.map((d) => (
          <article key={d.id} className="card">
            <p>
              {formatDateTime(locale, d.recordedAt)} · {locale === 'fa' ? 'ثبت‌کننده' : 'Actor'}:{' '}
              {d.actorName ?? (locale === 'fa' ? 'کاربر پیشین' : 'Former user')}
            </p>
            <p dir={textDir(locale)}>{d.reason}</p>
            <p>
              {locale === 'fa'
                ? 'گزینه‌های منتخب به ترتیب اولویت'
                : 'Selected alternatives in priority order'}
              : {d.snapshot.selected.map((s) => formatNumber(locale, s.ordinal)).join('، ')}
            </p>
            <ul>
              {d.snapshot.rejected.map((r) => (
                <li key={r.solutionId} dir={textDir(locale)}>
                  {locale === 'fa' ? 'گزینه' : 'Alternative'} {formatNumber(locale, r.ordinal)}:{' '}
                  {r.reason}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}

function List({
  locale,
  items,
  ordered = false,
}: {
  locale: Locale;
  items: string[];
  ordered?: boolean;
}) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className="output-list">
      {items.map((item, index) => (
        <li key={index} dir={textDir(locale)}>
          {item}
        </li>
      ))}
    </Tag>
  );
}
