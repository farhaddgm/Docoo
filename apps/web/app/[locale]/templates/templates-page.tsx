'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import {
  boundsProblem,
  boundsToRows,
  rowsToBounds,
  type Assignment,
  type Definition,
} from '../settings/settings-model';
import { Notice, useAction, explainError } from '../use-action';
import { WorkspacePage } from '../workspace-page';
import { templatesMessages } from './templates-messages';

interface Template {
  key: string;
  version: string;
  sections: { key: string; source: string; label: { fa: string; en: string } }[];
}

interface Catalog {
  templates: Template[];
  levelDefaults: Record<string, { min: number; max: number }>;
  countAlgorithm: string;
}

interface Current {
  bounds: { min: number; max: number }[];
  level: number;
  template: string;
  sequences: Record<string, number>;
}

const KEYS = {
  bounds: 'document.level_bounds',
  level: 'document.level',
  template: 'document.default_template',
} as const;

/** Templates and document levels (UX §2, ADR-0018): the length ranges and the draft layout. */
export function TemplatesPage({ locale }: { locale: Locale }) {
  const text = templatesMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Templates locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

function Templates({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = templatesMessages(locale);
  const base = `/workspaces/${workspaceId}`;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const scope = query({ scopeType: 'workspace', scopeId: workspaceId });
      const [templates, effective, assigned, definitions] = await Promise.all([
        apiGet<Catalog>(`${base}/document-templates`),
        apiGet<{ config: { values: Record<string, unknown> } }>(
          `${base}/settings/effective${scope}`,
        ),
        apiGet<{ items: Assignment[] }>(`${base}/settings/assignments${scope}`),
        apiGet<{ items: Definition[] }>(`${base}/settings/definitions`),
      ]);
      const values = effective.config.values;
      const template = values[KEYS.template];
      const fallbackBounds = definitions.items.find(
        (item) => item.key === KEYS.bounds,
      )?.defaultValue;
      setCatalog(templates);
      setCurrent({
        bounds: boundsToRows(values[KEYS.bounds]) ?? boundsToRows(fallbackBounds) ?? [],
        level: Number(values[KEYS.level] ?? 3),
        template: typeof template === 'string' ? template : 'standard',
        sequences: Object.fromEntries(assigned.items.map((item) => [item.key, item.sequence])),
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <p className="notice error" role="alert">
        {text.failed}
      </p>
    );
  }
  if (!catalog || !current) return <p role="status">{text.loading}</p>;
  return (
    <div className="stack">
      <LevelsSection
        locale={locale}
        base={base}
        workspaceId={workspaceId}
        catalog={catalog}
        current={current}
        onChanged={load}
      />
      <TemplatesSection
        locale={locale}
        base={base}
        workspaceId={workspaceId}
        catalog={catalog}
        current={current}
        onChanged={load}
      />
      <p className="muted">
        {text.moreSettings} <Link href={`/${locale}/settings` as Route}>{text.openSettings}</Link>
      </p>
    </div>
  );
}

function useSave(locale: Locale) {
  const text = templatesMessages(locale);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.genericError),
    [text],
  );
  return useAction(explain);
}

function LevelsSection({
  locale,
  base,
  workspaceId,
  catalog,
  current,
  onChanged,
}: {
  locale: Locale;
  base: string;
  workspaceId: string;
  catalog: Catalog;
  current: Current;
  onChanged: () => Promise<void>;
}) {
  const text = templatesMessages(locale);
  const id = useId();
  const action = useSave(locale);
  const [rows, setRows] = useState(
    current.bounds.map((row) => ({ min: String(row.min), max: String(row.max) })),
  );
  const [level, setLevel] = useState(String(current.level));
  const [reason, setReason] = useState('');

  const signature = JSON.stringify([current.bounds, current.level]);
  useEffect(() => {
    setRows(current.bounds.map((row) => ({ min: String(row.min), max: String(row.max) })));
    setLevel(String(current.level));
    setReason('');
  }, [signature]);

  const numbers = rows.map((row) => ({
    min: row.min.trim() === '' ? Number.NaN : Number(row.min),
    max: row.max.trim() === '' ? Number.NaN : Number(row.max),
  }));
  const problem = boundsProblem(numbers);
  const boundsChanged =
    JSON.stringify(rowsToBounds(numbers)) !== JSON.stringify(rowsToBounds(current.bounds));
  const levelChanged = Number(level) !== current.level;
  const canSave = problem === null && (boundsChanged || levelChanged) && reason.trim() !== '';

  const put = (key: string, value: unknown) =>
    apiSend('PUT', `${base}/settings/assignments`, {
      scopeType: 'workspace',
      scopeId: workspaceId,
      key,
      value,
      reason: reason.trim(),
      expectedSequence: current.sequences[key] ?? 0,
    });

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.levelsTitle}</h2>
      <p className="muted">{text.levelsHelp}</p>
      <Notice notice={action.notice} />
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.levelsTitle}>
        <table>
          <thead>
            <tr>
              <th scope="col">{text.levelColumn}</th>
              <th scope="col">{text.min}</th>
              <th scope="col">{text.max}</th>
              <th scope="col">{text.systemColumn}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const defaults = catalog.levelDefaults[String(index + 1)];
              return (
                <tr key={index}>
                  <th scope="row">{fill(text.level, { n: formatNumber(locale, index + 1) })}</th>
                  <td>
                    <input
                      id={`${id}-min-${index}`}
                      aria-label={`${fill(text.level, { n: formatNumber(locale, index + 1) })}: ${text.min}`}
                      dir="ltr"
                      type="number"
                      min={0}
                      step={1}
                      value={row.min}
                      onChange={(event) =>
                        setRows(
                          rows.map((item, i) =>
                            i === index ? { ...item, min: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      id={`${id}-max-${index}`}
                      aria-label={`${fill(text.level, { n: formatNumber(locale, index + 1) })}: ${text.max}`}
                      dir="ltr"
                      type="number"
                      min={0}
                      step={1}
                      value={row.max}
                      onChange={(event) =>
                        setRows(
                          rows.map((item, i) =>
                            i === index ? { ...item, max: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="muted">
                    {defaults
                      ? fill(text.systemBounds, {
                          min: formatNumber(locale, defaults.min),
                          max: formatNumber(locale, defaults.max),
                        })
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {problem && (
        <p className="notice error" role="alert">
          {fill(text.boundsProblems[problem.code]!, { level: formatNumber(locale, problem.level) })}
        </p>
      )}
      <div className="toolbar">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            setRows(
              [1, 2, 3, 4, 5].map((n) => ({
                min: String(catalog.levelDefaults[String(n)]!.min),
                max: String(catalog.levelDefaults[String(n)]!.max),
              })),
            )
          }
        >
          {text.restoreDefaults}
        </button>
      </div>
      <div className="filter-grid">
        <label htmlFor={`${id}-level`}>{text.defaultLevel}</label>
        <select id={`${id}-level`} value={level} onChange={(event) => setLevel(event.target.value)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {fill(text.level, { n: formatNumber(locale, n) })}
            </option>
          ))}
        </select>
        <p className="muted">{text.defaultLevelHelp}</p>
        <label htmlFor={`${id}-reason`}>{text.reasonLabel}</label>
        <input
          id={`${id}-reason`}
          dir="auto"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby={`${id}-reason-help`}
          autoComplete="off"
        />
        <p id={`${id}-reason-help`} className="muted">
          {text.reasonHelp}
        </p>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={!canSave || action.busy}
          onClick={() =>
            void action.run(async () => {
              if (boundsChanged) await put(KEYS.bounds, rowsToBounds(numbers));
              if (levelChanged) await put(KEYS.level, Number(level));
              await onChanged();
            }, text.savedLevels)
          }
        >
          {action.busy ? text.saving : text.saveLevels}
        </button>
      </div>
    </section>
  );
}

function TemplatesSection({
  locale,
  base,
  workspaceId,
  catalog,
  current,
  onChanged,
}: {
  locale: Locale;
  base: string;
  workspaceId: string;
  catalog: Catalog;
  current: Current;
  onChanged: () => Promise<void>;
}) {
  const text = templatesMessages(locale);
  const id = useId();
  const action = useSave(locale);
  const [selected, setSelected] = useState(current.template);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setSelected(current.template);
    setReason('');
  }, [current.template]);

  const canSave = selected !== current.template && reason.trim() !== '';
  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.templatesTitle}</h2>
      <p className="muted">{text.templatesHelp}</p>
      <Notice notice={action.notice} />
      <fieldset className="stack">
        <legend>{text.defaultTemplate}</legend>
        {catalog.templates.map((template) => (
          <div key={template.key} className="card stack">
            <label className="mode">
              <input
                type="radio"
                name={`${id}-template`}
                value={template.key}
                checked={selected === template.key}
                onChange={() => setSelected(template.key)}
              />{' '}
              <strong>{text.names[template.key] ?? template.key}</strong>
              {current.template === template.key && (
                <span className="badge tone-ok">{text.isDefault}</span>
              )}
            </label>
            <p className="muted">{text.purposes[template.key]}</p>
            <p>
              {text.sections}:{' '}
              <span dir="auto">
                {template.sections.map((section) => section.label[locale]).join(' ← ')}
              </span>
            </p>
            <p className="muted">
              {text.version}: <code dir="ltr">{template.version}</code>
            </p>
          </div>
        ))}
      </fieldset>
      <div className="filter-grid">
        <label htmlFor={`${id}-reason`}>{text.reasonLabel}</label>
        <input
          id={`${id}-reason`}
          dir="auto"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={!canSave || action.busy}
          onClick={() =>
            void action.run(async () => {
              await apiSend('PUT', `${base}/settings/assignments`, {
                scopeType: 'workspace',
                scopeId: workspaceId,
                key: KEYS.template,
                value: selected,
                reason: reason.trim(),
                expectedSequence: current.sequences[KEYS.template] ?? 0,
              });
              await onChanged();
            }, text.savedTemplate)
          }
        >
          {action.busy ? text.saving : text.saveTemplate}
        </button>
      </div>
    </section>
  );
}
