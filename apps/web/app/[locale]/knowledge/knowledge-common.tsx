'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

import { apiGet, query } from '../../api-client';
import { fill } from '../agents/agent-messages';
import type { KnowledgeText } from './knowledge-messages';
import {
  scopeRoles,
  type EffectiveDecision,
  type KnowledgeStatus,
  type ProjectOption,
  type Scope,
  type ScopeChoice,
  type ScopeRole,
  type ScopeType,
  type SourceStatus,
  type TopicOption,
} from './knowledge-types';
import { FieldLabel, GroupLabel, InfoTip } from '../../info-tip';
import { textDir, type Locale } from '../../i18n';

/** A status is told by its words; the tone only supports them. */
export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function statusTone(status: KnowledgeStatus | null): Tone {
  switch (status) {
    case 'approved':
      return 'ok';
    case 'rejected':
      return 'danger';
    case 'draft':
    case 'pending':
    case 'in_review':
    case 'needs_revision':
    case 'expired':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function decisionTone(decision: EffectiveDecision): Tone {
  switch (decision) {
    case 'approved':
    case 'approved_by_override':
      return 'ok';
    case 'rejected':
    case 'rejected_by_override':
    case 'stale':
      return 'danger';
    case 'needs_revision':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function sourceTone(status: SourceStatus): Tone {
  switch (status) {
    case 'indexed':
      return 'ok';
    case 'partial':
      return 'warn';
    case 'rejected':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The name of a scope (and the role it is limited to) in words. */
export function scopeText(
  text: KnowledgeText,
  scope: { type: ScopeType; title: string | null; role?: string | null },
): string {
  const name =
    scope.type === 'workspace'
      ? text.workspaceScope
      : fill(scope.type === 'topic' ? text.topicScope : text.projectScope, {
          title: scope.title ?? text.removedScope,
        });
  if (!scope.role) return name;
  const role = text.roleNames[scope.role as ScopeRole] ?? scope.role;
  return `${name} · ${fill(text.onlyRole, { role })}`;
}

export function ScopeList({
  locale,
  text,
  scopes,
}: {
  locale: Locale;
  text: KnowledgeText;
  scopes: readonly Scope[];
}) {
  return (
    <ul className="plain-list">
      {scopes.map((scope) => (
        <li key={`${scope.type}:${scope.id}:${scope.role ?? ''}`} dir={textDir(locale)}>
          {scopeText(text, scope)}
        </li>
      ))}
    </ul>
  );
}

export interface ScopeOptions {
  topics: TopicOption[];
  projects: ProjectOption[];
  /** The topics or projects could not all be loaded. */
  incomplete: boolean;
}

/** Pages of a list endpoint are read until they run out, up to a sane ceiling. */
async function loadAll<T>(path: string, params: Record<string, string>): Promise<T[] | null> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const result = await apiGet<{ items: T[]; nextCursor: string | null }>(
      `${path}${query({ ...params, limit: '100', cursor })}`,
    );
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  return null;
}

/** The topics and projects a source or knowledge can be scoped to. */
export function useScopeOptions(workspaceId: string): ScopeOptions | null {
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  useEffect(() => {
    let active = true;
    const base = `/workspaces/${workspaceId}`;
    void Promise.allSettled([
      loadAll<TopicOption>(`${base}/topics`, { status: 'active' }),
      loadAll<ProjectOption>(`${base}/projects`, { status: 'current' }),
    ]).then(([topics, projects]) => {
      if (!active) return;
      const topicItems = topics.status === 'fulfilled' ? topics.value : null;
      const projectItems = projects.status === 'fulfilled' ? projects.value : null;
      setOptions({
        topics: topicItems ?? [],
        projects: projectItems ?? [],
        incomplete: topicItems === null || projectItems === null,
      });
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  return options;
}

export const choiceKey = (choice: ScopeChoice): string => `${choice.type}:${choice.id}`;

export function parseChoice(key: string): ScopeChoice {
  const separator = key.indexOf(':');
  return { type: key.slice(0, separator) as ScopeType, id: key.slice(separator + 1) };
}

/** A select of the places knowledge can belong to: the workspace, its topics and projects. */
export function ScopeSelect({
  id,
  label,
  hideLabel = false,
  help,
  value,
  onChange,
  workspaceId,
  options,
  text,
  disabled,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  /** Explains the choice; shown behind the "i" next to the title. */
  help?: string | undefined;
  value: ScopeChoice;
  onChange: (next: ScopeChoice) => void;
  workspaceId: string;
  options: ScopeOptions | null;
  text: KnowledgeText;
  disabled?: boolean | undefined;
}) {
  const known = new Set(
    [
      `workspace:${workspaceId}`,
      ...(options?.topics.map((topic) => `topic:${topic.id}`) ?? []),
      ...(options?.projects.map((project) => `project:${project.id}`) ?? []),
    ].filter(Boolean),
  );
  const current = choiceKey(value);
  return (
    <>
      {hideLabel ? (
        <label htmlFor={id} className="visually-hidden">
          {label}
        </label>
      ) : (
        <FieldLabel htmlFor={id} help={help} {...(help ? { helpId: `${id}-help` } : {})}>
          {label}
        </FieldLabel>
      )}
      <select
        id={id}
        value={current}
        disabled={disabled}
        {...(help ? { 'aria-describedby': `${id}-help` } : {})}
        onChange={(event) => onChange(parseChoice(event.target.value))}
      >
        <option value={`workspace:${workspaceId}`}>{text.workspaceScope}</option>
        {options && options.topics.length > 0 && (
          <optgroup label={text.topicsGroup}>
            {options.topics.map((topic) => (
              <option key={topic.id} value={`topic:${topic.id}`}>
                {topic.title}
              </option>
            ))}
          </optgroup>
        )}
        {options && options.projects.length > 0 && (
          <optgroup label={text.projectsGroup}>
            {options.projects.map((project) => (
              <option key={project.id} value={`project:${project.id}`}>
                {project.code} — {project.title}
              </option>
            ))}
          </optgroup>
        )}
        {/* A scope that is not in the lists (archived topic) must not silently change. */}
        {!known.has(current) && <option value={current}>{current}</option>}
      </select>
    </>
  );
}

export interface ScopeRow extends ScopeChoice {
  role: ScopeRole | '';
}

/** Editor of the scopes of one knowledge item: where it applies and for which roles. */
export function ScopeEditor({
  rows,
  onChange,
  workspaceId,
  options,
  text,
  help,
  disabled,
}: {
  rows: readonly ScopeRow[];
  onChange: (next: ScopeRow[]) => void;
  workspaceId: string;
  options: ScopeOptions | null;
  text: KnowledgeText;
  /** Explains the role choice and the add button; shown behind an "i" next to each. */
  help?: { role: string; add: string };
  disabled?: boolean | undefined;
}) {
  const id = useId();
  const update = (index: number, patch: Partial<ScopeRow>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="field-stack">
      <legend>
        <GroupLabel help={text.scopeHelp}>{text.scopeHeading}</GroupLabel>
      </legend>
      {options?.incomplete && <p className="muted">{text.scopeListIncomplete}</p>}
      <ul className="plain-list">
        {rows.map((row, index) => {
          const n = String(index + 1);
          return (
            <li key={`${id}-${index}`} className="scope-row">
              <ScopeSelect
                id={`${id}-scope-${index}`}
                label={fill(text.scopeN, { n })}
                value={row}
                onChange={(next) => update(index, next)}
                workspaceId={workspaceId}
                options={options}
                text={text}
                disabled={disabled}
              />
              <label htmlFor={`${id}-role-${index}`} className="visually-hidden">
                {`${fill(text.scopeN, { n })}: ${text.roleChoose}`}
              </label>
              <select
                id={`${id}-role-${index}`}
                value={row.role}
                disabled={disabled}
                onChange={(event) => update(index, { role: event.target.value as ScopeRole | '' })}
              >
                <option value="">{text.allRoles}</option>
                {scopeRoles.map((role) => (
                  <option key={role} value={role}>
                    {fill(text.onlyRole, { role: text.roleNames[role] })}
                  </option>
                ))}
              </select>
              {help && <InfoTip text={help.role} />}
              {rows.length > 1 && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
                >
                  {fill(text.removeScope, { n })}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            onChange([...rows, { type: 'workspace', id: workspaceId, role: '' as const }])
          }
        >
          {text.addScope}
        </button>
        {help && <InfoTip text={help.add} />}
      </p>
    </fieldset>
  );
}

/** The scopes as the API takes them, with a role only where one was chosen. */
export function scopesPayload(rows: readonly ScopeRow[]) {
  const seen = new Set<string>();
  const result: { type: ScopeType; id: string; role?: ScopeRole }[] = [];
  for (const row of rows) {
    const key = `${row.type}:${row.id}:${row.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: row.type, id: row.id, ...(row.role ? { role: row.role } : {}) });
  }
  return result;
}

/** `datetime-local` text to an ISO instant, or undefined when it is empty or not a date. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** An ISO instant as the text a `datetime-local` input takes (browser local time). */
export function isoToLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Items in one line, separated the way the language writes a list. */
export const joinList = (locale: 'fa' | 'en', items: readonly string[]): string =>
  items.join(locale === 'fa' ? '، ' : ', ');

/** An http(s) address a person can follow; anything else (doi:, an id) stays plain text. */
export function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
