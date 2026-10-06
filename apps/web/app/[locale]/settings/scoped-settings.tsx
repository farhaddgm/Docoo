'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Notice, useAction } from '../use-action';
import { ModelPicker } from './model-picker';
import { settingsMessages, type SettingsText } from './settings-messages';
import {
  EDITED_ELSEWHERE,
  NOT_ENFORCED,
  PROVIDER_PAGE,
  SETTING_GROUPS,
  parseControlText,
  sameValue,
  sourceKind,
  toControlText,
  type Assignment,
  type ControlProblem,
  type Definition,
  type Effective,
  type Scope,
} from './settings-model';
import { explainSettingError } from './settings-errors';

export function displayValue(
  locale: Locale,
  text: SettingsText,
  definition: Definition,
  value: unknown,
): string {
  if (typeof value === 'boolean') return value ? text.yes : text.no;
  if (Array.isArray(value)) {
    return value.length === 0
      ? text.emptyValue
      : value
          .map((item) => (typeof item === 'number' ? formatNumber(locale, item) : String(item)))
          .join(', ');
  }
  if (typeof value === 'string') {
    if (value === '') return text.emptyValue;
    return text.enumLabels[definition.key]?.[value] ?? value;
  }
  return typeof value === 'number' ? formatNumber(locale, value) : text.emptyValue;
}

export function problemText(locale: Locale, text: SettingsText, problem: ControlProblem): string {
  const show = (value: number | undefined) =>
    value === undefined ? '' : formatNumber(locale, value);
  return fill(text.problems[problem.code] ?? text.problems['bad_format']!, {
    min: show(problem.min),
    max: show(problem.max),
    line: show(problem.line),
  });
}

/**
 * The settings of one scope (the workspace, or one project) grouped by what they control.
 * Each row shows the value that applies and where it comes from, and changes it with a reason
 * (FR-CFG-*); the server keeps every version and the page can restore an earlier one.
 */
export function ScopedSettings({
  locale,
  workspaceId,
  scopeType,
  scopeId,
}: {
  locale: Locale;
  workspaceId: string;
  scopeType: Extract<Scope, 'workspace' | 'project'>;
  scopeId: string;
}) {
  const text = settingsMessages(locale);
  const base = `/workspaces/${workspaceId}/settings`;
  const [definitions, setDefinitions] = useState<Definition[] | null>(null);
  const [effective, setEffective] = useState<Effective | null>(null);
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(new Map());
  const [failed, setFailed] = useState(false);
  const explain = useCallback((error: unknown) => explainSettingError(error, text), [text]);
  const action = useAction(explain);

  const load = useCallback(async () => {
    try {
      const scope = query({ scopeType, scopeId });
      const [defs, eff, assigned] = await Promise.all([
        apiGet<{ items: Definition[] }>(`${base}/definitions`),
        apiGet<{ config: Effective }>(`${base}/effective${scope}`),
        apiGet<{ items: Assignment[] }>(`${base}/assignments${scope}`),
      ]);
      setDefinitions(defs.items);
      setEffective(eff.config);
      setAssignments(new Map(assigned.items.map((item) => [item.key, item])));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base, scopeId, scopeType]);

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
  if (!definitions || !effective) return <p role="status">{text.loading}</p>;

  return (
    <div className="stack">
      <p className="muted">{text.scopeHelp[scopeType]}</p>
      <Notice notice={action.notice} />
      {SETTING_GROUPS.map((group) => {
        const rows = group.keys
          .map((key) => definitions.find((item) => item.key === key))
          .filter(
            (item): item is Definition =>
              item !== undefined &&
              !item.sensitive &&
              item.allowedScopes.includes(scopeType) &&
              // A project's model has its own section: connection and model go together.
              !(scopeType === 'project' && PROVIDER_PAGE.has(item.key)),
          );
        if (rows.length === 0) return null;
        const info = text.groups[group.id];
        return (
          <GroupSection key={group.id} title={info.title} help={info.help}>
            {rows.map((definition) => (
              <SettingRow
                key={definition.key}
                locale={locale}
                workspaceId={workspaceId}
                scopeType={scopeType}
                scopeId={scopeId}
                definition={definition}
                effective={effective}
                assignment={assignments.get(definition.key) ?? null}
                action={action}
                onChanged={load}
              />
            ))}
          </GroupSection>
        );
      })}
    </div>
  );
}

function GroupSection({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="muted">{help}</p>
      <ul className="plain-list stack">{children}</ul>
    </section>
  );
}

type Action = ReturnType<typeof useAction>;

function SettingRow({
  locale,
  workspaceId,
  scopeType,
  scopeId,
  definition,
  effective,
  assignment,
  action,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  scopeType: Extract<Scope, 'workspace' | 'project'>;
  scopeId: string;
  definition: Definition;
  effective: Effective;
  assignment: Assignment | null;
  action: Action;
  onChanged: () => Promise<void>;
}) {
  const text = settingsMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}/settings`;
  const value = effective.values[definition.key];
  const source = effective.sources[definition.key];
  const kind = sourceKind(source);
  const own = assignment !== null && !assignment.cleared;
  const [draft, setDraft] = useState(toControlText(definition.valueSchema, value));
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const description = definition.description[locale];

  // A reload or a restore brings a new value: the control starts from it again.
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    setDraft(toControlText(definition.valueSchema, value));
    setReason('');
  }, [valueKey]);

  const readOnly = EDITED_ELSEWHERE.has(definition.key) || PROVIDER_PAGE.has(definition.key);
  const parsed = parseControlText(definition.valueSchema, draft);
  const changed = parsed.ok && !sameValue(parsed.value, value);
  const canSave = parsed.ok && changed && reason.trim() !== '';

  const send = (next: unknown, okText: string) =>
    action.run(async () => {
      await apiSend('PUT', `${base}/assignments`, {
        scopeType,
        scopeId,
        key: definition.key,
        value: next,
        reason: reason.trim(),
        expectedSequence: assignment?.sequence ?? 0,
      });
      await onChanged();
    }, okText);

  return (
    <li className="stack" aria-labelledby={`${id}-name`}>
      <div>
        <strong id={`${id}-name`} dir="auto">
          {description}
        </strong>{' '}
        <code dir="ltr">{definition.key}</code>
      </div>
      <p className="muted">
        {text.sourceLabel}:{' '}
        <span className={`badge tone-${kind === 'system' ? 'neutral' : 'ok'}`}>
          {text.sources[kind]}
        </span>{' '}
        {text.defaultValue}: {displayValue(locale, text, definition, definition.defaultValue)}
      </p>
      {NOT_ENFORCED.has(definition.key) && <p className="notice">{text.notEnforced}</p>}
      {readOnly ? (
        <p>
          {text.currentValue}:{' '}
          <strong dir="auto">{displayValue(locale, text, definition, value)}</strong>
          {definition.key === 'document.level_bounds' && (
            <>
              {' — '}
              {text.onTemplatesPage}{' '}
              <Link href={`/${locale}/templates` as Route}>{text.openTemplates}</Link>
            </>
          )}
          {PROVIDER_PAGE.has(definition.key) && scopeType === 'workspace' && (
            <>
              {' — '}
              {text.onProvidersPage}{' '}
              <Link href={`/${locale}/providers` as Route}>{text.openProviders}</Link>
            </>
          )}
        </p>
      ) : (
        <>
          <SettingControl
            id={`${id}-value`}
            locale={locale}
            definition={definition}
            draft={draft}
            onChange={setDraft}
            describedBy={!parsed.ok ? `${id}-problem` : undefined}
          />
          {!parsed.ok && (
            <p id={`${id}-problem`} className="notice error" role="alert">
              {problemText(locale, text, parsed.problem)}
            </p>
          )}
          <div className="filter-grid">
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
                parsed.ok && void send(parsed.value, fill(text.saved, { key: definition.key }))
              }
            >
              {action.busy ? text.saving : text.save}
            </button>
            {own && (
              <button
                type="button"
                className="secondary-button"
                disabled={reason.trim() === '' || action.busy}
                onClick={() => void send(null, fill(text.reset, { key: definition.key }))}
              >
                {scopeType === 'project' ? text.resetProject : text.resetWorkspace}
              </button>
            )}
          </div>
        </>
      )}
      <button
        type="button"
        className="link-like"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? text.hideHistory : text.history}
      </button>
      {open && (
        <History
          locale={locale}
          base={base}
          scopeType={scopeType}
          scopeId={scopeId}
          definition={definition}
          reason={reason}
          action={action}
          refreshKey={`${assignment?.sequence ?? 0}`}
          onChanged={onChanged}
        />
      )}
    </li>
  );
}

export function SettingControl({
  id,
  locale,
  definition,
  draft,
  onChange,
  describedBy,
}: {
  id: string;
  locale: Locale;
  definition: Definition;
  draft: string;
  onChange: (next: string) => void;
  describedBy: string | undefined;
}) {
  const text = settingsMessages(locale);
  const schema = definition.valueSchema;
  const label = definition.description[locale];
  if (schema.type === 'boolean') {
    return (
      <label className="mode">
        <input
          id={id}
          type="checkbox"
          checked={draft === 'true'}
          aria-describedby={describedBy}
          onChange={(event) => onChange(String(event.target.checked))}
        />{' '}
        {label}
      </label>
    );
  }
  if (schema.type === 'string' && schema.enum) {
    return (
      <div className="filter-grid">
        <label htmlFor={id}>{text.currentValue}</label>
        <select
          id={id}
          value={draft}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {schema.enum.map((option) => (
            <option key={option} value={option}>
              {text.enumLabels[definition.key]?.[option] ?? option}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (schema.type === 'array' && schema.items?.enum) {
    // A fixed set of choices: tick the ones that apply (the order is the order of the choices).
    const options = schema.items.enum;
    const chosen = new Set(
      draft
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    );
    return (
      <fieldset id={id} aria-describedby={describedBy}>
        <legend>{label}</legend>
        {options.map((option) => (
          <label key={option} className="mode">
            <input
              type="checkbox"
              checked={chosen.has(option)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(option);
                else next.delete(option);
                onChange(options.filter((item) => next.has(item)).join('\n'));
              }}
            />{' '}
            {text.enumLabels[definition.key]?.[option] ?? option}
          </label>
        ))}
      </fieldset>
    );
  }
  if (schema.type === 'array') {
    return (
      <div className="filter-grid">
        <label htmlFor={id}>{text.currentValue}</label>
        <textarea
          id={id}
          dir="ltr"
          rows={4}
          value={draft}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <p className="muted">{text.onePerLine}</p>
      </div>
    );
  }
  const numeric = schema.type === 'integer' || schema.type === 'number';
  return (
    <div className="filter-grid">
      <label htmlFor={id}>{text.currentValue}</label>
      <input
        id={id}
        dir={numeric ? 'ltr' : 'auto'}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === 'integer' ? 1 : 'any'}
        maxLength={schema.maxLength}
        value={draft}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {schema.minimum !== undefined && schema.maximum !== undefined && (
        <p className="muted">
          {fill(text.range, {
            min: formatNumber(locale, schema.minimum),
            max: formatNumber(locale, schema.maximum),
          })}
        </p>
      )}
    </div>
  );
}

function History({
  locale,
  base,
  scopeType,
  scopeId,
  definition,
  reason,
  action,
  refreshKey,
  onChanged,
}: {
  locale: Locale;
  base: string;
  scopeType: Scope;
  scopeId: string;
  definition: Definition;
  reason: string;
  action: Action;
  refreshKey: string;
  onChanged: () => Promise<void>;
}) {
  const text = settingsMessages(locale);
  const [items, setItems] = useState<Assignment[] | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<{ items: Assignment[] }>(
      `${base}/assignments/history${query({ scopeType, scopeId, key: definition.key })}`,
    )
      .then((result) => {
        if (active) setItems([...result.items].sort((a, b) => b.sequence - a.sequence));
      })
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [base, scopeType, scopeId, definition.key, refreshKey]);

  if (items === null) return <p role="status">{text.loading}</p>;
  if (items.length === 0) return <p className="muted">{text.historyEmpty}</p>;
  return (
    <ol className="version-list">
      {items.map((item, index) => (
        <li key={item.sequence} className="version-row">
          <strong>{fill(text.historyVersion, { n: formatNumber(locale, item.sequence) })}</strong>{' '}
          <span className="muted">{formatDateTime(locale, item.createdAt)}</span>
          <p dir="auto">
            {item.cleared
              ? text.historyCleared
              : displayValue(locale, text, definition, item.value)}
            {item.restoredFromSequence !== null &&
              ` — ${fill(text.historyRestored, { n: formatNumber(locale, item.restoredFromSequence) })}`}
          </p>
          <p className="muted" dir="auto">
            {item.reason}
          </p>
          {index > 0 && (
            <button
              type="button"
              className="secondary-button"
              disabled={reason.trim() === '' || action.busy}
              onClick={() =>
                void action.run(
                  async () => {
                    await apiSend('POST', `${base}/assignments/restore`, {
                      scopeType,
                      scopeId,
                      key: definition.key,
                      sequence: item.sequence,
                      reason: reason.trim(),
                    });
                    await onChanged();
                  },
                  fill(text.restored, { key: definition.key }),
                )
              }
            >
              {text.restore}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The project's own model: connection and model saved together, or both cleared. */
export function ProjectModelSection({
  locale,
  workspaceId,
  projectId,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
}) {
  const text = settingsMessages(locale);
  const base = `/workspaces/${workspaceId}/settings`;
  const id = useId();
  const [connectionId, setConnectionId] = useState('');
  const [model, setModel] = useState('');
  const [reason, setReason] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [assignments, setAssignments] = useState<Map<string, Assignment>>(new Map());
  const explain = useCallback((error: unknown) => explainSettingError(error, text), [text]);
  const action = useAction(explain);

  const load = useCallback(async () => {
    const scope = query({ scopeType: 'project', scopeId: projectId });
    const assigned = await apiGet<{ items: Assignment[] }>(`${base}/assignments${scope}`);
    const map = new Map(assigned.items.map((item) => [item.key, item]));
    setAssignments(map);
    const own = (key: string) => {
      const item = map.get(key);
      return item && !item.cleared && typeof item.value === 'string' ? item.value : '';
    };
    setConnectionId(own('ai.connection_id'));
    setModel(own('ai.model'));
    setLoaded(true);
  }, [base, projectId]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const set = (key: string, value: string | null) =>
    apiSend('PUT', `${base}/assignments`, {
      scopeType: 'project',
      scopeId: projectId,
      key,
      value,
      reason: reason.trim(),
      expectedSequence: assignments.get(key)?.sequence ?? 0,
    });

  const inherited = connectionId === '';
  const ready = inherited ? assignments.size > 0 : model !== '';
  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.groups.ai.title}</h2>
      <p className="muted">{text.groups.ai.help}</p>
      <Notice notice={action.notice} />
      {loaded && (
        <ModelPicker
          locale={locale}
          workspaceId={workspaceId}
          connectionId={connectionId}
          model={model}
          idPrefix={id}
          onChange={(nextConnection, nextModel) => {
            setConnectionId(nextConnection);
            setModel(nextModel);
          }}
        />
      )}
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
          disabled={!ready || reason.trim() === '' || action.busy}
          onClick={() =>
            void action.run(
              async () => {
                await set('ai.connection_id', inherited ? null : connectionId);
                await set('ai.model', inherited ? null : model);
                await load();
              },
              fill(text.saved, { key: 'ai.model' }),
            )
          }
        >
          {action.busy ? text.saving : text.picker.saveModel}
        </button>
      </div>
    </section>
  );
}
