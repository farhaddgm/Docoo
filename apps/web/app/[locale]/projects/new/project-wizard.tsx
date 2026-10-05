'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../../../api-client';
import { formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { ModelPicker } from '../../settings/model-picker';
import { displayValue, problemText, SettingControl } from '../../settings/scoped-settings';
import { settingsMessages } from '../../settings/settings-messages';
import {
  NOT_ENFORCED,
  SETTING_GROUPS,
  parseControlText,
  sameValue,
  sourceKind,
  toControlText,
  type Definition,
  type Effective,
} from '../../settings/settings-model';
import { explainError, Notice, useAction } from '../../use-action';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import {
  BasicsFields,
  PROJECT_CODE_PATTERN,
  TopicsSection,
  emptyProject,
  type ProjectValues,
} from '../project-fields';
import { CriteriaEditor, criteriaIssue, sameCriteria, type Criterion } from './criteria-editor';
import { wizardMessages } from './wizard-messages';

/** The settings each step offers, in the order of UX §5 (steps 3 to 7). */
const STEP_KEYS: Record<number, readonly string[]> = {
  2: [
    'workflow.require_human_approval',
    'workflow.max_attempts_per_stage',
    'ai.max_cost_usd_per_run',
  ],
  4: [
    'research.max_queries',
    'research.knowledge_limit',
    'research.max_sources',
    'knowledge.min_audit_score',
  ],
  5: ['solution.count'],
  6: ['document.level', 'document.default_template', 'document.default_export_format'],
};
const STEP_COUNT = 8;
const MODEL_STEP = 3;
const SOLUTIONS_STEP = 5;
const REVIEW_STEP = 7;
const MAX_CODE = 64;

interface Draft {
  step: number;
  values: ProjectValues;
  /** Texts the administrator changed; a key missing here keeps its inherited value. */
  touched: Record<string, string>;
  connectionId: string;
  model: string;
  /** The criteria the administrator changed; null keeps the defaults. */
  criteria?: Criterion[] | null;
}

const draftKey = (workspaceId: string) => `docoo:new-project:${workspaceId}`;

function readDraft(workspaceId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(workspaceId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(workspaceId: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(workspaceId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(workspaceId));
  } catch {
    // Private windows and blocked storage: the wizard works the same without a draft.
  }
}

/**
 * Creating a project in eight steps (UX §5, ADR-0018): basics, topics, workflow, model,
 * knowledge, solutions, documents and a review of the effective configuration. Everything the
 * administrator changes is sent with the project and saved in one transaction; a value left
 * alone stays inherited from the topics and the workspace.
 */
export function ProjectWizard({
  locale,
  workspaceId,
  onCreated,
}: {
  locale: Locale;
  workspaceId: string;
  onCreated: (projectId: string) => void;
}) {
  const text = wizardMessages(locale);
  const project = projectMessages(locale);
  const settings = settingsMessages(locale);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const explain = useCallback(
    (error: unknown) =>
      error instanceof ApiError && error.code?.startsWith('CONFIG_')
        ? explainError(error, settings.errors, settings.genericError)
        : explainProject(error, project),
    [project, settings],
  );
  const action = useAction(explain);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ProjectValues>(() => emptyProject(locale));
  const [touched, setTouched] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState('');
  const [model, setModel] = useState('');
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [defaultCriteria, setDefaultCriteria] = useState<Criterion[] | null>(null);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [baseline, setBaseline] = useState<Effective | null>(null);
  const [review, setReview] = useState<Effective | null>(null);
  const [reviewFailed, setReviewFailed] = useState(false);
  const base = `/workspaces/${workspaceId}`;

  // A draft left earlier comes back; the wizard saves one after every change.
  useEffect(() => {
    const draft = readDraft(workspaceId);
    if (draft) {
      setStep(Math.min(Math.max(draft.step, 0), STEP_COUNT - 1));
      setValues(draft.values);
      setTouched(draft.touched ?? {});
      setConnectionId(draft.connectionId ?? '');
      setModel(draft.model ?? '');
      setCriteria(draft.criteria ?? null);
      setRestored(true);
    }
    setReady(true);
  }, [workspaceId]);

  useEffect(() => {
    if (!ready) return;
    writeDraft(workspaceId, { step, values, touched, connectionId, model, criteria });
  }, [ready, workspaceId, step, values, touched, connectionId, model, criteria]);

  useEffect(() => {
    apiGet<{ items: Definition[] }>(`${base}/settings/definitions`)
      .then((result) => setDefinitions(result.items))
      .catch(() => undefined);
  }, [base]);

  useEffect(() => {
    apiGet<{ criteria: Criterion[] }>(`${base}/solution-criteria/defaults`)
      .then((result) => setDefaultCriteria(result.criteria))
      .catch(() => undefined);
  }, [base]);

  const topicIds = useMemo(() => values.topics.map((topic) => topic.topicId), [values.topics]);
  const topicKey = topicIds.join(',');

  // What each setting is before the project changes it: the workspace and the chosen topics.
  useEffect(() => {
    let active = true;
    apiSend<{ config: Effective }>('POST', `${base}/settings/preview`, {
      topicIds,
      settings: [],
    })
      .then((result) => active && setBaseline(result.config))
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // topicKey stands for topicIds (a new array every render would loop).
  }, [base, topicKey]);

  const definition = useCallback(
    (key: string) => definitions.find((item) => item.key === key),
    [definitions],
  );

  /** The values that differ from the inherited ones, or the first problem found. */
  const choices = useMemo(() => {
    const overrides: { key: string; value: unknown }[] = [];
    let problem: { key: string; text: string } | null = null;
    for (const [key, raw] of Object.entries(touched)) {
      const def = definitions.find((item) => item.key === key);
      if (!def || !baseline) continue;
      const parsed = parseControlText(def.valueSchema, raw);
      if (!parsed.ok) {
        problem ??= { key, text: problemText(locale, settings, parsed.problem) };
        continue;
      }
      if (!sameValue(parsed.value, baseline.values[key]))
        overrides.push({ key, value: parsed.value });
    }
    if (connectionId && model) {
      overrides.push({ key: 'ai.connection_id', value: connectionId });
      overrides.push({ key: 'ai.model', value: model });
    }
    return { overrides, problem };
  }, [touched, definitions, baseline, connectionId, model, settings]);

  // The review asks the server which value wins at each level (the first topic has priority 1).
  useEffect(() => {
    if (step !== REVIEW_STEP) return;
    let active = true;
    setReview(null);
    setReviewFailed(false);
    apiSend<{ config: Effective }>('POST', `${base}/settings/preview`, {
      topicIds,
      settings: choices.overrides,
    })
      .then((result) => active && setReview(result.config))
      .catch(() => active && setReviewFailed(true));
    return () => {
      active = false;
    };
    // The overrides are recomputed from the same inputs; the review is read once per visit.
  }, [step]);

  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [step, ready]);

  const trimmed = {
    code: values.code.trim(),
    title: values.title.trim(),
    problem: values.initialProblem.trim(),
  };
  const basicsOk =
    PROJECT_CODE_PATTERN.test(trimmed.code) &&
    trimmed.code.length <= MAX_CODE &&
    trimmed.title !== '' &&
    trimmed.problem !== '';
  // Criteria are sent only when they differ from the defaults the server would use anyway.
  const shownCriteria = criteria ?? defaultCriteria;
  const customCriteria =
    criteria !== null && defaultCriteria !== null && !sameCriteria(criteria, defaultCriteria)
      ? criteria
      : null;
  const criteriaProblem = customCriteria ? criteriaIssue(customCriteria) : null;
  const stepProblem = (() => {
    if (step === 0 && !basicsOk) return text.needBasics;
    if (step === SOLUTIONS_STEP && criteriaProblem !== null)
      return criteriaProblem === 'none_enabled'
        ? text.criteriaNoneEnabled
        : fill(text.criteriaNotHundred, { n: formatNumber(locale, criteriaProblem) });
    const own = STEP_KEYS[step];
    if (own && choices.problem && own.includes(choices.problem.key)) return choices.problem.text;
    return null;
  })();

  function submit() {
    void action.run(async () => {
      const { project: created } = await apiSend<{ project: { id: string } }>(
        'POST',
        `${base}/projects`,
        {
          code: trimmed.code,
          title: trimmed.title,
          description: values.description.trim(),
          initialProblem: trimmed.problem,
          outputLanguage: values.outputLanguage,
          topics: values.topics.map((topic) => ({
            topicId: topic.topicId,
            ...(topic.conflictInstruction.trim()
              ? { conflictInstruction: topic.conflictInstruction.trim() }
              : {}),
          })),
          settings: choices.overrides,
          ...(customCriteria
            ? {
                solutionCriteria: customCriteria.map((item) => ({
                  ...item,
                  label: item.label.trim(),
                })),
              }
            : {}),
        },
      );
      writeDraft(workspaceId, null);
      onCreated(created.id);
    }, project.created);
  }

  function discard() {
    writeDraft(workspaceId, null);
    setValues(emptyProject(locale));
    setTouched({});
    setConnectionId('');
    setModel('');
    setCriteria(null);
    setStep(0);
    setRestored(false);
  }

  const stepName = text.steps[step]!;
  const keys = STEP_KEYS[step];
  return (
    <div className="stack">
      <nav aria-label={text.stepsLabel}>
        <ol className="plain-list toolbar">
          {text.steps.map((name, index) => (
            <li key={name}>
              <span
                className={`badge tone-${index < step ? 'ok' : 'neutral'}`}
                aria-current={index === step ? 'step' : undefined}
              >
                {formatNumber(locale, index + 1)}. {name}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <p className="muted">{text.draftSaved}</p>
      {restored && (
        <p className="notice" role="status">
          {text.draftRestored}{' '}
          <button type="button" className="link-like" onClick={discard}>
            {text.discardDraft}
          </button>
        </p>
      )}
      <Notice notice={action.notice} />

      <section className="card stack" aria-labelledby={`${id}-step`}>
        <h2 id={`${id}-step`} tabIndex={-1} ref={heading}>
          {fill(text.stepOf, {
            n: formatNumber(locale, step + 1),
            total: formatNumber(locale, STEP_COUNT),
          })}
          {' — '}
          {stepName}
        </h2>
        <p className="muted">{text.stepHelp[step]}</p>

        {step === 0 && <BasicsFields locale={locale} values={values} onChange={setValues} />}
        {step === 1 && (
          <TopicsSection
            locale={locale}
            workspaceId={workspaceId}
            values={values}
            onChange={setValues}
          />
        )}
        {step === MODEL_STEP && (
          <ModelPicker
            locale={locale}
            workspaceId={workspaceId}
            connectionId={connectionId}
            model={model}
            idPrefix={`${id}-model`}
            onChange={(nextConnection, nextModel) => {
              setConnectionId(nextConnection);
              setModel(nextModel);
            }}
          />
        )}
        {keys && baseline && (
          <ul className="plain-list stack">
            {keys.map((key) => {
              const def = definition(key);
              if (!def) return null;
              const inherited = baseline.values[key];
              const draft = touched[key] ?? toControlText(def.valueSchema, inherited);
              const parsed = parseControlText(def.valueSchema, draft);
              const changed = key in touched && parsed.ok && !sameValue(parsed.value, inherited);
              return (
                <li key={key} className="stack">
                  <SettingControl
                    id={`${id}-${key}`}
                    locale={locale}
                    definition={def}
                    draft={draft}
                    onChange={(next) => setTouched({ ...touched, [key]: next })}
                    describedBy={`${id}-${key}-note`}
                  />
                  <p id={`${id}-${key}-note`} className="muted">
                    <code dir="ltr">{key}</code> —{' '}
                    {changed ? (
                      <strong>{text.changedHere}</strong>
                    ) : (
                      <>
                        {text.inherited}: {displayValue(locale, settings, def, inherited)} (
                        {settings.sources[sourceKind(baseline.sources[key])]})
                      </>
                    )}
                    {NOT_ENFORCED.has(key) && <> — {settings.notEnforced}</>}
                  </p>
                  {!parsed.ok && (
                    <p className="notice error" role="alert">
                      {problemText(locale, settings, parsed.problem)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {step === SOLUTIONS_STEP &&
          (shownCriteria ? (
            <CriteriaEditor
              locale={locale}
              idPrefix={`${id}-criteria`}
              criteria={shownCriteria}
              onChange={setCriteria}
            />
          ) : (
            <p role="status">{text.criteriaLoading}</p>
          ))}
        {step === SOLUTIONS_STEP && customCriteria && (
          <div>
            <button type="button" className="link-like" onClick={() => setCriteria(null)}>
              {text.criteriaReset}
            </button>
          </div>
        )}
        {step === REVIEW_STEP && (
          <Review
            locale={locale}
            definitions={definitions}
            review={review}
            failed={reviewFailed}
            overrides={choices.overrides.length}
            values={values}
            connectionId={connectionId}
            criteriaCount={
              customCriteria ? customCriteria.filter((item) => item.enabled).length : null
            }
          />
        )}
        {stepProblem && (
          <p className="notice error" role="alert">
            {stepProblem}
          </p>
        )}
      </section>

      <div className="toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={step === 0 || action.busy}
          onClick={() => setStep(step - 1)}
        >
          {text.back}
        </button>
        {step < STEP_COUNT - 1 ? (
          <button
            type="button"
            className="primary-button"
            disabled={stepProblem !== null || action.busy}
            onClick={() => setStep(step + 1)}
          >
            {text.next}
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={
              !basicsOk || choices.problem !== null || criteriaProblem !== null || action.busy
            }
            onClick={submit}
          >
            {action.busy ? text.creating : text.create}
          </button>
        )}
      </div>
    </div>
  );
}

function Review({
  locale,
  definitions,
  review,
  failed,
  overrides,
  values,
  connectionId,
  criteriaCount,
}: {
  locale: Locale;
  definitions: Definition[];
  review: Effective | null;
  failed: boolean;
  overrides: number;
  values: ProjectValues;
  connectionId: string;
  criteriaCount: number | null;
}) {
  const text = wizardMessages(locale);
  const settings = settingsMessages(locale);
  const project = projectMessages(locale);
  if (failed) {
    return (
      <p className="notice error" role="alert">
        {text.reviewFailed}
      </p>
    );
  }
  if (!review) return <p role="status">{text.reviewLoading}</p>;
  const rows = SETTING_GROUPS.flatMap((group) => group.keys)
    .map((key) => definitions.find((item) => item.key === key))
    .filter(
      (item): item is Definition =>
        item !== undefined && !item.sensitive && item.allowedScopes.includes('project'),
    );
  return (
    <div className="stack">
      <h3>{text.summary}</h3>
      <dl className="facts">
        <div>
          <dt>{project.titleLabel}</dt>
          <dd dir="auto">{values.title.trim()}</dd>
        </div>
        <div>
          <dt>{project.codeLabel}</dt>
          <dd dir="ltr">{values.code.trim()}</dd>
        </div>
        <div>
          <dt>{project.outputLanguage}</dt>
          <dd>{project.languages[values.outputLanguage]}</dd>
        </div>
        <div>
          <dt>{project.topicsSection}</dt>
          <dd>{formatNumber(locale, values.topics.length)}</dd>
        </div>
        {!connectionId && (
          <div>
            <dt>{settings.picker.model}</dt>
            <dd>{text.modelInherited}</dd>
          </div>
        )}
        <div>
          <dt>{text.criteriaSummary}</dt>
          <dd>
            {criteriaCount === null
              ? text.criteriaDefault
              : fill(text.criteriaCustom, { n: formatNumber(locale, criteriaCount) })}
          </dd>
        </div>
      </dl>
      <p>
        {overrides > 0
          ? fill(text.overridesCount, { n: formatNumber(locale, overrides) })
          : text.noOverrides}
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.reviewTable}>
        <table>
          <thead>
            <tr>
              <th scope="col">{text.setting}</th>
              <th scope="col">{text.value}</th>
              <th scope="col">{text.source}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((def) => {
              const kind = sourceKind(review.sources[def.key]);
              return (
                <tr key={def.key}>
                  <th scope="row" dir="auto">
                    {def.description[locale]} <code dir="ltr">{def.key}</code>
                  </th>
                  <td dir="auto">{displayValue(locale, settings, def, review.values[def.key])}</td>
                  <td>
                    <span className={`badge tone-${kind === 'pending' ? 'ok' : 'neutral'}`}>
                      {settings.sources[kind]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
