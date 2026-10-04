'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { ApiError, apiGet } from '../../api-client';
import { formatNumber, type Locale } from '../../i18n';
import { explainError, Notice, useAction } from '../use-action';
import { agentMessages, fill, type AgentMessages } from './agent-messages';
import {
  changedSections,
  changesBody,
  draftOf,
  sections as allSections,
  type AgentTool,
  type Definition,
  type Draft,
  type ModelWarning,
  type Reference,
  type Section,
} from './agent-types';
import { diffLines, diffText, hasChanges, type DiffLine } from './diff';
import { DiffView } from './diff-view';

interface Connection {
  id: string;
  provider: string;
  name: string;
  status: string;
}

interface Model {
  id: string;
  displayName: string;
  capabilities?: { structuredOutput?: boolean };
}

/** Machine-readable problems arrive as `field:code[:index]`. */
function describeProblem(problem: string, text: AgentMessages): string {
  const [field = '', code = '', index] = problem.split(':');
  const where = text.issueFields[field] ?? field;
  const what = text.issues[code] ?? text.errors['AGENT_INVALID_DEFINITION'] ?? problem;
  return index === undefined ? `${where}: ${what}` : `${where} ${Number(index) + 1}: ${what}`;
}

function RuleList({
  idPrefix,
  items,
  labelOf,
  addLabel,
  removeTemplate,
  moveUpTemplate,
  moveDownTemplate,
  counterTemplate,
  maxItems,
  maxLength,
  locale,
  problemIndexes,
  disabled,
  onChange,
}: {
  idPrefix: string;
  items: string[];
  labelOf: (n: number) => string;
  addLabel: string;
  removeTemplate: string;
  moveUpTemplate: string;
  moveDownTemplate: string;
  counterTemplate: string;
  maxItems: number;
  maxLength: number;
  locale: Locale;
  problemIndexes: ReadonlySet<number>;
  disabled: boolean;
  onChange: (items: string[]) => void;
}) {
  function move(index: number, by: -1 | 1) {
    const next = [...items];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }
  return (
    <div className="rule-list">
      <ol className="rule-rows">
        {items.map((item, index) => {
          const label = labelOf(index + 1);
          const id = `${idPrefix}-${index}`;
          return (
            <li key={index} className="rule-row">
              <label htmlFor={id}>{label}</label>
              <textarea
                id={id}
                rows={2}
                dir="auto"
                maxLength={maxLength}
                value={item}
                disabled={disabled}
                aria-invalid={problemIndexes.has(index) ? true : undefined}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              />
              <span className="rule-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === 0}
                  aria-label={fill(moveUpTemplate, { label })}
                  onClick={() => move(index, -1)}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === items.length - 1}
                  aria-label={fill(moveDownTemplate, { label })}
                  onClick={() => move(index, 1)}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  aria-label={fill(removeTemplate, { label })}
                  onClick={() => onChange(items.filter((_, position) => position !== index))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || items.length >= maxItems}
          onClick={() => onChange([...items, ''])}
        >
          {addLabel}
        </button>
        <span className="muted">
          {fill(counterTemplate, {
            n: formatNumber(locale, items.length),
            max: formatNumber(locale, maxItems),
          })}
        </span>
      </p>
    </div>
  );
}

/**
 * The editor of one role's definition (FR-AGT-002, FR-AGT-005): rule lists, the task, the tool
 * allowlist inside the role's ceiling, an optional own model, a diff against the version it
 * starts from, and a reason. It saves through `submit`, which appends a version.
 */
export function RoleEditor({
  locale,
  workspaceId,
  base,
  reference,
  serverWarnings,
  saveLabel,
  disabled = false,
  submit,
  after,
}: {
  locale: Locale;
  workspaceId: string;
  /** The version the edit starts from; the parent re-keys the editor when it changes. */
  base: Definition;
  reference: Reference;
  serverWarnings: readonly ModelWarning[];
  saveLabel: string;
  disabled?: boolean;
  submit: (changes: Record<string, unknown>, reason: string) => Promise<Definition>;
  /** Rendered under the form once a version was saved (for example an activate button). */
  after?: (saved: Definition) => ReactNode;
}) {
  const text = agentMessages(locale);
  const id = useId();
  const baseDraft = useMemo(() => draftOf(base), [base]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(base));
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<Definition | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, Model[] | null>>({});
  const explain = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.problems.length > 0) setProblems([...error.problems]);
      return explainError(error, text.errors, text.failed);
    },
    [text],
  );
  const { busy, notice, run } = useAction(explain);
  const base_ = `/workspaces/${workspaceId}`;

  useEffect(() => {
    let live = true;
    apiGet<{ items: Connection[] }>(`${base_}/provider-connections`)
      .then((result) => {
        if (live) setConnections(result.items.filter((item) => item.status !== 'disabled'));
      })
      .catch(() => {
        if (live) setConnections([]);
      });
    return () => {
      live = false;
    };
  }, [base_]);

  const chosenConnection = draft.modelPolicy?.connectionId ?? '';
  useEffect(() => {
    if (!chosenConnection || chosenConnection in catalogs) return;
    let live = true;
    apiGet<{ catalog: { models: Model[] } | null }>(
      `${base_}/provider-connections/${chosenConnection}/models`,
    )
      .then((result) => {
        if (live)
          setCatalogs((all) => ({ ...all, [chosenConnection]: result.catalog?.models ?? null }));
      })
      .catch(() => {
        if (live) setCatalogs((all) => ({ ...all, [chosenConnection]: null }));
      });
    return () => {
      live = false;
    };
  }, [base_, chosenConnection, catalogs]);

  const changed = changedSections(baseDraft, draft);
  const problemIndexes = (field: string) =>
    new Set(
      problems
        .map((problem) => problem.split(':'))
        .filter(([f, , index]) => f === field && index !== undefined)
        .map(([, , index]) => Number(index)),
    );

  const catalog = chosenConnection ? catalogs[chosenConnection] : undefined;
  const chosenModel = draft.modelPolicy?.model ?? '';
  const clientWarning: ModelWarning | null = (() => {
    if (!draft.modelPolicy || !chosenConnection || !chosenModel) return null;
    if (catalog === undefined) return null;
    if (catalog === null || catalog.length === 0) return 'catalog_missing';
    const model = catalog.find((candidate) => candidate.id === chosenModel);
    if (!model) return 'model_not_in_catalog';
    return model.capabilities?.structuredOutput === false ? 'no_structured_output' : null;
  })();
  const warnings: ModelWarning[] = [];
  if (clientWarning) warnings.push(clientWarning);
  else if (JSON.stringify(draft.modelPolicy) === JSON.stringify(baseDraft.modelPolicy)) {
    warnings.push(...serverWarnings);
  }

  function setList(field: 'principles' | 'duties', items: string[]) {
    setDraft((current) => ({ ...current, [field]: items }));
    setProblems([]);
  }

  function toggle(tool: AgentTool, on: boolean) {
    setDraft((current) => ({
      ...current,
      tools: on
        ? reference.tools.filter(
            (candidate) => candidate === tool || current.tools.includes(candidate),
          )
        : current.tools.filter((candidate) => candidate !== tool),
    }));
    setProblems([]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: string[] = [];
    if (reason.trim().length < reference.limits.minReasonLength) found.push('reason:required');
    if (changed.length === 0) found.push('changes:none');
    if ([...draft.principles, ...draft.duties].some((item) => item.trim() === '')) {
      found.push('items:empty');
    }
    if (draft.modelPolicy && (!draft.modelPolicy.connectionId || !draft.modelPolicy.model.trim())) {
      found.push('model:incomplete');
    }
    setProblems(found);
    if (found.length > 0) return;
    void run(async () => {
      setSaved(await submit(changesBody(baseDraft, draft), reason.trim()));
      setReason('');
    }, '');
  }

  const clientMessages: Record<string, string> = {
    'reason:required': text.clientIssues.needReason,
    'changes:none': text.clientIssues.needChange,
    'items:empty': text.clientIssues.emptyItem,
    'model:incomplete': text.clientIssues.needModel,
  };
  const messageOf = (problem: string) => clientMessages[problem] ?? describeProblem(problem, text);

  const previews: Record<Section, DiffLine[]> = {
    principles: diffLines(
      baseDraft.principles,
      draft.principles.map((item) => item.trim()),
    ),
    duties: diffLines(
      baseDraft.duties,
      draft.duties.map((item) => item.trim()),
    ),
    prompt: diffText(baseDraft.promptTemplate, draft.promptTemplate.trim()),
    tools: diffLines(
      [...baseDraft.tools].sort().map((tool) => text.tools[tool].label),
      [...draft.tools].sort().map((tool) => text.tools[tool].label),
    ),
    model: diffLines(
      [baseDraft.modelPolicy ? `${baseDraft.modelPolicy.model}` : text.defaultModel],
      [draft.modelPolicy ? `${draft.modelPolicy.model || '—'}` : text.defaultModel],
    ),
  };

  const locked = disabled || busy;
  const limits = reference.limits;
  const models = catalog ?? [];

  return (
    <form className="stack" onSubmit={onSubmit} noValidate aria-busy={busy}>
      <fieldset className="field-stack" disabled={locked}>
        <legend>{text.sections.principles}</legend>
        <p className="muted">{text.principlesHelp}</p>
        <RuleList
          idPrefix={`${id}-principle`}
          items={draft.principles}
          labelOf={(n) => fill(text.principleLabel, { n: formatNumber(locale, n) })}
          addLabel={text.addPrinciple}
          removeTemplate={text.removeItem}
          moveUpTemplate={text.moveUp}
          moveDownTemplate={text.moveDown}
          counterTemplate={text.counter}
          maxItems={limits.maxItems}
          maxLength={limits.maxItemLength}
          locale={locale}
          problemIndexes={problemIndexes('principles')}
          disabled={locked}
          onChange={(items) => setList('principles', items)}
        />
      </fieldset>

      <fieldset className="field-stack" disabled={locked}>
        <legend>{text.sections.duties}</legend>
        <p className="muted">{text.dutiesHelp}</p>
        <RuleList
          idPrefix={`${id}-duty`}
          items={draft.duties}
          labelOf={(n) => fill(text.dutyLabel, { n: formatNumber(locale, n) })}
          addLabel={text.addDuty}
          removeTemplate={text.removeItem}
          moveUpTemplate={text.moveUp}
          moveDownTemplate={text.moveDown}
          counterTemplate={text.counter}
          maxItems={limits.maxItems}
          maxLength={limits.maxItemLength}
          locale={locale}
          problemIndexes={problemIndexes('duties')}
          disabled={locked}
          onChange={(items) => setList('duties', items)}
        />
      </fieldset>

      <div className="field-stack">
        <label htmlFor={`${id}-prompt`}>{text.promptLabel}</label>
        <p id={`${id}-prompt-help`} className="muted">
          {text.promptHelp}
        </p>
        <textarea
          id={`${id}-prompt`}
          rows={6}
          dir="auto"
          maxLength={limits.maxPromptLength}
          value={draft.promptTemplate}
          disabled={locked}
          aria-describedby={`${id}-prompt-help`}
          aria-invalid={
            problems.some((problem) => problem.startsWith('promptTemplate:')) || undefined
          }
          onChange={(event) => {
            setDraft((current) => ({ ...current, promptTemplate: event.target.value }));
            setProblems([]);
          }}
        />
        <span className="muted">
          {fill(text.counter, {
            n: formatNumber(locale, draft.promptTemplate.length),
            max: formatNumber(locale, limits.maxPromptLength),
          })}
        </span>
      </div>

      <fieldset className="field-stack" disabled={locked}>
        <legend>{text.sections.tools}</legend>
        <p className="muted">{text.toolsHelp}</p>
        <div className="tool-grid">
          {reference.toolCeiling.map((tool) => (
            <label key={tool} className="tool-choice">
              <input
                type="checkbox"
                checked={draft.tools.includes(tool)}
                onChange={(event) => toggle(tool, event.target.checked)}
                aria-describedby={`${id}-tool-${tool}`}
              />{' '}
              <span>{text.tools[tool].label}</span>
              <small id={`${id}-tool-${tool}`} className="muted">
                {text.tools[tool].help}
              </small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field-stack" disabled={locked}>
        <legend>{text.modelHeading}</legend>
        <p className="muted">{text.modelHelp}</p>
        <div className="mode-choice">
          <label className="mode">
            <input
              type="radio"
              name={`${id}-model-mode`}
              checked={draft.modelPolicy === null}
              onChange={() => {
                setDraft((current) => ({ ...current, modelPolicy: null }));
                setProblems([]);
              }}
            />{' '}
            {text.useDefaultModel}
          </label>
          <label className="mode">
            <input
              type="radio"
              name={`${id}-model-mode`}
              checked={draft.modelPolicy !== null}
              onChange={() => {
                setDraft((current) => ({
                  ...current,
                  modelPolicy: current.modelPolicy ?? {
                    connectionId: connections?.[0]?.id ?? '',
                    model: '',
                  },
                }));
                setProblems([]);
              }}
            />{' '}
            {text.useOwnModel}
          </label>
        </div>
        {draft.modelPolicy && (
          <div className="filter-grid">
            <div className="field-stack">
              <label htmlFor={`${id}-connection`}>{text.connection}</label>
              <select
                id={`${id}-connection`}
                value={draft.modelPolicy.connectionId}
                onChange={(event) => {
                  const connectionId = event.target.value;
                  setDraft((current) => ({ ...current, modelPolicy: { connectionId, model: '' } }));
                  setProblems([]);
                }}
              >
                <option value="">{text.chooseConnection}</option>
                {(connections ?? []).map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({connection.provider})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-stack">
              <label htmlFor={`${id}-model`}>{text.model}</label>
              <select
                id={`${id}-model`}
                value={draft.modelPolicy.model}
                disabled={!chosenConnection}
                onChange={(event) => {
                  const model = event.target.value;
                  setDraft((current) => ({
                    ...current,
                    modelPolicy: current.modelPolicy ? { ...current.modelPolicy, model } : null,
                  }));
                  setProblems([]);
                }}
              >
                <option value="">{text.chooseModel}</option>
                {chosenModel && !models.some((model) => model.id === chosenModel) && (
                  <option value={chosenModel}>{chosenModel}</option>
                )}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName || model.id}
                  </option>
                ))}
              </select>
              {chosenConnection && catalog !== undefined && models.length === 0 && (
                <small className="muted">{text.noModels}</small>
              )}
            </div>
          </div>
        )}
        {warnings.map((warning) => (
          <p key={warning} className="notice error" role="status">
            {text.modelWarnings[warning]}
          </p>
        ))}
      </fieldset>

      <details className="field-stack">
        <summary>{text.schemaHeading}</summary>
        <p className="muted">{text.schemaHelp}</p>
        {reference.outputSchema ? (
          <pre className="schema-view" dir="ltr" tabIndex={0}>
            {JSON.stringify(reference.outputSchema, null, 2)}
          </pre>
        ) : (
          <p className="muted">{text.schemaNone}</p>
        )}
      </details>

      <section className="card stack" aria-labelledby={`${id}-preview`}>
        <h3 id={`${id}-preview`}>{text.preview}</h3>
        {changed.length === 0 ? (
          <p className="muted">{text.noChanges}</p>
        ) : (
          allSections
            .filter((section) => changed.includes(section) && hasChanges(previews[section]))
            .map((section) => (
              <div key={section}>
                <h4>{text.sections[section]}</h4>
                <DiffView lines={previews[section]} text={text} />
              </div>
            ))
        )}
      </section>

      <div className="field-stack">
        <label htmlFor={`${id}-reason`}>{text.reasonLabel}</label>
        <p id={`${id}-reason-help`} className="muted">
          {text.reasonHelp}
        </p>
        <input
          id={`${id}-reason`}
          dir="auto"
          maxLength={limits.maxReasonLength}
          value={reason}
          disabled={locked}
          aria-describedby={`${id}-reason-help`}
          aria-invalid={problems.includes('reason:required') || undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setProblems([]);
          }}
        />
      </div>

      {problems.length > 0 && (
        <div className="notice error" role="alert">
          <ul className="plain-list">
            {problems.map((problem) => (
              <li key={problem}>{messageOf(problem)}</li>
            ))}
          </ul>
        </div>
      )}
      <Notice notice={notice} />

      <p className="toolbar">
        <button type="submit" className="primary-button" disabled={locked}>
          {busy ? text.saving : saveLabel}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={locked || changed.length === 0}
          onClick={() => {
            setDraft(draftOf(base));
            setProblems([]);
          }}
        >
          {text.reset}
        </button>
      </p>
      {saved && after?.(saved)}
    </form>
  );
}
