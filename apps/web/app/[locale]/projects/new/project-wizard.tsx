'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../../../api-client';
import {
  candidateProblemTemplates,
  type ProblemPatternDefinition,
  type ProblemTemplateId,
} from '@docoo/contracts';
import { formatNumber, type Locale, textDir } from '../../../i18n';
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
import { BusinessPicker } from '../business-picker';
import { businessMessages } from '../business-messages';
import type { ContenterBusinessItem } from '../business-types';
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
import { quickDraftMessages } from '../quick-draft-messages';
import { wizardMessages } from './wizard-messages';
import {
  ADVANCED_SECTIONS,
  ADVANCED_STEP,
  CONTEXT_STEP,
  PROBLEM_STEP,
  REQUIRED_STEPS,
  REVIEW_STEP,
  STEP_COUNT,
  changedInSection,
  migrateDraftStep,
  reachableSteps,
  seedFields,
  shouldApplySeed,
  shouldSuggestCode,
  suggestProjectCode,
  type AdvancedSection,
  type CandidateSeed,
  type DraftSource,
} from './wizard-model';
import { FieldLabel, InfoTip, SectionTitle } from '../../../info-tip';

const MAX_CODE = 64;

interface Draft {
  /** 2 for the four-step wizard (ADR-0035); a draft without it came from the eight-step one. */
  v?: number;
  step: number;
  /** The person edited the code by hand, so the title no longer suggests one. */
  codeTouched?: boolean;
  values: ProjectValues;
  /** Texts the administrator changed; a key missing here keeps its inherited value. */
  touched: Record<string, string>;
  connectionId: string;
  model: string;
  /** The criteria the administrator changed; null keeps the defaults. */
  criteria?: Criterion[] | null;
  /** The business of Contenter the project is linked to (ADR-0021). */
  business?: ContenterBusinessItem | null;
  problemTemplateId?: ProblemTemplateId | '';
  problemPatternVersionId?: string;
  /** The candidate problem the draft was started from (ADR-0044), so a reload keeps what was typed. */
  source?: DraftSource | null;
}

interface PublishedProblemPattern {
  id: string;
  patternId: string;
  key: string;
  version: number;
  definition: ProblemPatternDefinition;
  publishedAt: string;
}

const draftKey = (workspaceId: string) => `docoo:new-project:${workspaceId}`;

/** Review values are shown at most 60 characters long; the rest is replaced by "...". */
const REVIEW_VALUE_MAX = 60;
function clip(value: string): string {
  const chars = Array.from(value);
  return chars.length > REVIEW_VALUE_MAX
    ? `${chars.slice(0, REVIEW_VALUE_MAX).join('')}...`
    : value;
}

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
 * Creating a project in four steps (UX §5, ADR-0035): the problem, the context and method, the
 * optional advanced settings (workflow, model, knowledge, solutions, documents) and a review of
 * the effective configuration. Everything the administrator changes is sent with the project and
 * saved in one transaction; a value left alone stays inherited from the topics and the workspace.
 */
export function ProjectWizard({
  locale,
  workspaceId,
  seed = null,
  onCreated,
}: {
  locale: Locale;
  workspaceId: string;
  /** A candidate problem of an exploration the project is made from (ADR-0044); null for a plain one. */
  seed?: CandidateSeed | null;
  onCreated: (projectId: string) => void;
}) {
  const text = wizardMessages(locale);
  const project = projectMessages(locale);
  const settings = settingsMessages(locale);
  const businessText = businessMessages(locale);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const explain = useCallback(
    (error: unknown) =>
      error instanceof ApiError && error.code?.startsWith('CONFIG_')
        ? explainError(error, settings.errors, settings.genericError)
        : explainProject(error, project, businessText.errors),
    [project, settings, businessText],
  );
  const action = useAction(explain);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ProjectValues>(() => emptyProject(locale));
  const [touched, setTouched] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState('');
  const [model, setModel] = useState('');
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [business, setBusiness] = useState<ContenterBusinessItem | null>(null);
  const [problemTemplateId, setProblemTemplateId] = useState<ProblemTemplateId | ''>('');
  const [problemPatternVersionId, setProblemPatternVersionId] = useState('');
  const [publishedProblemPatterns, setPublishedProblemPatterns] = useState<
    PublishedProblemPattern[]
  >([]);
  const [codeTouched, setCodeTouched] = useState(false);
  // Event handlers own this flag; an unrelated concurrent render must not reset it.
  const codeTouchedRef = useRef(false);
  const [opened, setOpened] = useState<Partial<Record<AdvancedSection, boolean>>>({});
  const [defaultCriteria, setDefaultCriteria] = useState<Criterion[] | null>(null);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [baseline, setBaseline] = useState<Effective | null>(null);
  const [review, setReview] = useState<Effective | null>(null);
  const [reviewFailed, setReviewFailed] = useState(false);
  // The inherited values could not be read (a dropped connection); the user may try again.
  const [baselineFailed, setBaselineFailed] = useState(false);
  const [baselineTry, setBaselineTry] = useState(0);
  const base = `/workspaces/${workspaceId}`;

  // A draft left earlier comes back; the wizard saves one after every change.
  useEffect(() => {
    const stored = readDraft(workspaceId);
    // A draft started from this very candidate comes back with what was typed since. Any other
    // draft is not carried into a project made from a candidate: it starts fresh from the candidate.
    const applySeed = seed !== null && shouldApplySeed(stored?.source, seed);
    const draft = applySeed ? null : stored;
    if (draft) {
      // A draft of the eight-step wizard has no version; its step is mapped onto the new four.
      const restoredStep = draft.v === 2 ? draft.step : migrateDraftStep(draft.step);
      setStep(Math.min(Math.max(restoredStep, 0), STEP_COUNT - 1));
      codeTouchedRef.current = draft.codeTouched ?? draft.values.code.trim() !== '';
      setCodeTouched(codeTouchedRef.current);
      // Drafts saved before topic knowledge sharing existed have no such fields.
      setValues({
        ...draft.values,
        // Drafts saved before the expected output existed have no such field.
        expectedOutput: draft.values.expectedOutput ?? '',
        topics: draft.values.topics.map((topic) => ({
          ...topic,
          knowledgeSharing: topic.knowledgeSharing ?? 'none',
        })),
        sharedKnowledgeIds: draft.values.sharedKnowledgeIds ?? [],
      });
      setTouched(draft.touched ?? {});
      setConnectionId(draft.connectionId ?? '');
      setModel(draft.model ?? '');
      setCriteria(draft.criteria ?? null);
      setBusiness(draft.business ?? null);
      setProblemTemplateId(draft.problemTemplateId ?? '');
      setProblemPatternVersionId(draft.problemPatternVersionId ?? '');
      setRestored(true);
    }
    if (seed && applySeed) {
      const fields = seedFields(seed);
      // A project made from a candidate is a new start: its code is suggested from its title.
      codeTouchedRef.current = false;
      setCodeTouched(false);
      setValues((current) => ({
        ...current,
        ...fields,
        code: shouldSuggestCode(fields.title) ? suggestProjectCode(fields.title) : '',
      }));
    }
    setReady(true);
  }, [workspaceId]);

  useEffect(() => {
    if (!ready) return;
    writeDraft(workspaceId, {
      v: 2,
      step,
      codeTouched,
      values,
      touched,
      connectionId,
      model,
      criteria,
      business,
      problemTemplateId,
      problemPatternVersionId,
      source: seed ? { explorationId: seed.explorationId, candidateKey: seed.candidateKey } : null,
    });
  }, [
    ready,
    workspaceId,
    step,
    codeTouched,
    values,
    touched,
    connectionId,
    model,
    criteria,
    business,
    problemTemplateId,
    problemPatternVersionId,
  ]);

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

  useEffect(() => {
    apiGet<{ items: PublishedProblemPattern[] }>(`${base}/projects/problem-pattern-versions`)
      .then((result) => setPublishedProblemPatterns(result.items))
      .catch(() => setPublishedProblemPatterns([]));
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
      .then((result) => {
        if (!active) return;
        setBaseline(result.config);
        setBaselineFailed(false);
      })
      .catch(() => active && setBaselineFailed(true));
    return () => {
      active = false;
    };
    // topicKey stands for topicIds (a new array every render would loop).
  }, [base, topicKey, baselineTry]);

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

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const first = !focusedOnce.current;
    focusedOnce.current = true;
    // The form is enabled a tick before this effect runs, so a fast user may already be typing in
    // a field; taking focus away on that first run would swallow the text. Later runs (a new
    // step) always move focus to the step heading, also where a button click gives it no focus.
    const active = document.activeElement;
    if (
      first &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement)
    )
      return;
    heading.current?.focus();
  }, [step, ready]);

  const trimmed = {
    code: values.code.trim(),
    title: values.title.trim(),
    problem: values.initialProblem.trim(),
  };
  const selectedProblemTemplate =
    candidateProblemTemplates.find(({ id: templateId }) => templateId === problemTemplateId) ??
    null;
  const selectedProblemPattern =
    publishedProblemPatterns.find(({ id }) => id === problemPatternVersionId) ?? null;
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
  // The workspace or a topic can require every project to belong to a business.
  const businessRequired = baseline?.values['business.required'] === true;
  const businessProblem = businessRequired && business === null;
  // The section of the advanced step that holds a value which cannot be sent, if any.
  const problemSection: AdvancedSection | null = (() => {
    if (choices.problem) {
      const found = ADVANCED_SECTIONS.find((section) =>
        (section.keys as readonly string[]).includes(choices.problem!.key),
      );
      if (found) return found.id;
    }
    return criteriaProblem !== null ? 'solutions' : null;
  })();
  const advancedProblem = (() => {
    if (criteriaProblem !== null)
      return criteriaProblem === 'none_enabled'
        ? text.criteriaNoneEnabled
        : fill(text.criteriaNotHundred, { n: formatNumber(locale, criteriaProblem) });
    return choices.problem?.text ?? null;
  })();
  const stepProblem = (() => {
    if (step === PROBLEM_STEP && !basicsOk) return text.needBasics;
    if (step === CONTEXT_STEP && businessProblem) return businessText.picker.needed;
    if (step === ADVANCED_STEP) return advancedProblem;
    return null;
  })();
  const reachable = reachableSteps({ problem: basicsOk, context: !businessProblem });
  const changedKeys = new Set(choices.overrides.map((item) => item.key));

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
          ...(values.expectedOutput.trim() ? { expectedOutput: values.expectedOutput.trim() } : {}),
          ...(problemTemplateId ? { problemTemplateId } : {}),
          ...(problemPatternVersionId ? { problemPatternVersionId } : {}),
          ...(seed
            ? {
                explorationCandidate: {
                  explorationId: seed.explorationId,
                  candidateKey: seed.candidateKey,
                },
              }
            : {}),
          outputLanguage: values.outputLanguage,
          analysisProfile: values.analysisProfile ?? 'full',
          topics: values.topics.map((topic) => ({
            topicId: topic.topicId,
            ...(topic.conflictInstruction.trim()
              ? { conflictInstruction: topic.conflictInstruction.trim() }
              : {}),
            knowledgeSharing: topic.knowledgeSharing,
          })),
          settings: choices.overrides,
          ...(business ? { businessId: business.id } : {}),
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
    setProblemTemplateId('');
    setProblemPatternVersionId('');
    setTouched({});
    setConnectionId('');
    setModel('');
    setCriteria(null);
    setBusiness(null);
    codeTouchedRef.current = false;
    setCodeTouched(false);
    setOpened({});
    setStep(0);
    setRestored(false);
  }

  /** Apply only the field that emitted the event, against the latest committed state. */
  function changeBasics(next: ProjectValues, field: keyof ProjectValues) {
    if (field === 'code') {
      codeTouchedRef.current = next.code.trim() !== '';
      setCodeTouched(codeTouchedRef.current);
    }
    const manuallyChosen = codeTouchedRef.current;
    setValues((current) => {
      let merged: ProjectValues = { ...current, [field]: next[field] };
      if (field === 'title' && !manuallyChosen) {
        const suggestion = shouldSuggestCode(next.title) ? suggestProjectCode(next.title) : '';
        const keep = suggestion.startsWith('PRJ-') && current.code.startsWith('PRJ-');
        merged = { ...merged, code: keep ? current.code : suggestion };
      }
      return merged;
    });
  }

  const stepName = text.steps[step]!;
  const modelChanged = connectionId !== '' && model !== '';
  const criteriaChanged = customCriteria !== null;
  const sectionCounts = ADVANCED_SECTIONS.map((section) =>
    changedInSection(section.id, changedKeys, { modelChanged, criteriaChanged }),
  );
  const totalChanged = sectionCounts.reduce((sum, count) => sum + count, 0);

  function goTo(index: number) {
    if (index <= step || index <= reachable) setStep(index);
  }

  /** How the stepper shows a step the person has left: finished, or still missing something. */
  function stepMark(index: number): 'done' | 'problem' | null {
    if (index >= step) return null;
    if (index === PROBLEM_STEP) return basicsOk ? 'done' : 'problem';
    if (index === CONTEXT_STEP) return businessProblem ? 'problem' : 'done';
    if (index === ADVANCED_STEP) return advancedProblem ? 'problem' : 'done';
    return null;
  }

  const settingsList = (keys: readonly string[]) =>
    baseline && keys.length > 0 ? (
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
    ) : null;

  return (
    <fieldset
      className="stack wizard-fields"
      disabled={!ready}
      aria-busy={!ready}
      aria-label={project.newTitle}
    >
      <nav aria-label={text.stepsLabel}>
        <ol className="stepper">
          {text.steps.map((name, index) => {
            const mark = stepMark(index);
            const required = REQUIRED_STEPS.includes(index);
            return (
              <li
                key={name}
                className={
                  mark === 'done' ? 'step-done' : mark === 'problem' ? 'step-problem' : undefined
                }
                aria-current={index === step ? 'step' : undefined}
              >
                <button
                  type="button"
                  className="step-button"
                  disabled={!(index <= step || index <= reachable)}
                  onClick={() => goTo(index)}
                >
                  <span className="step-number" aria-hidden="true">
                    {mark === 'done' ? '✓' : formatNumber(locale, index + 1)}
                  </span>
                  <span className="step-name">
                    <span className="visually-hidden">{formatNumber(locale, index + 1)}. </span>
                    {name}
                  </span>
                  <span className="step-kind">
                    {required ? text.required : text.optional}
                    {mark === 'done' && (
                      <span className="visually-hidden"> — {text.stepDoneMark}</span>
                    )}
                    {mark === 'problem' && <> — {text.stepNeedsWork}</>}
                    {index === ADVANCED_STEP && totalChanged > 0 && (
                      <>
                        {' '}
                        — {fill(text.stepChangedCount, { n: formatNumber(locale, totalChanged) })}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
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
        <SectionTitle
          id={`${id}-step`}
          focusable
          help={
            step === ADVANCED_STEP
              ? `${text.stepHelp[step]} ${text.advancedIntro}`
              : text.stepHelp[step]
          }
        >
          {fill(text.stepOf, {
            n: formatNumber(locale, step + 1),
            total: formatNumber(locale, STEP_COUNT),
          })}
          {' — '}
          {stepName}
        </SectionTitle>

        {step === PROBLEM_STEP && (
          <>
            {seed && (
              <p className="notice" role="note">
                {fill(text.seedBanner, {
                  candidate: seed.candidateTitle,
                  exploration: seed.explorationTitle,
                })}{' '}
                <Link href={`/${locale}/explorations/${seed.explorationId}` as Route}>
                  {text.seedOpen}
                </Link>
              </p>
            )}
            <BasicsFields locale={locale} values={values} onChange={changeBasics} />
            <div className="filter-grid">
              <FieldLabel
                htmlFor="problem-template"
                help={text.problemTemplateNote}
                helpId="problem-template-note"
              >
                {text.problemTemplate}
              </FieldLabel>
              <select
                id="problem-template"
                value={problemTemplateId}
                onChange={(event) =>
                  setProblemTemplateId(event.target.value as ProblemTemplateId | '')
                }
                aria-describedby="problem-template-note"
              >
                <option value="">{text.noProblemTemplate}</option>
                {candidateProblemTemplates.map((template) => (
                  <option key={`${template.id}@${template.version}`} value={template.id}>
                    {template.name[locale]} · v{template.version}
                  </option>
                ))}
              </select>
              {problemTemplateId && (
                <>
                  {(() => {
                    const selectedTemplate = candidateProblemTemplates.find(
                      ({ id: templateId }) => templateId === problemTemplateId,
                    );
                    if (!selectedTemplate) return null;
                    return (
                      <>
                        <ul aria-label={text.problemTemplatePrompts}>
                          {selectedTemplate.prompts.map((prompt) => (
                            <li key={prompt.id}>
                              <strong>{prompt.label[locale]}:</strong> {prompt.guidance[locale]}
                            </li>
                          ))}
                        </ul>
                        <h3>{text.problemTemplateRubric}</h3>
                        <ul>
                          {selectedTemplate.rubric.criteria.map((criterion) => (
                            <li key={criterion.key}>
                              {criterion.label[locale]} · {formatNumber(locale, criterion.weight)}٪
                            </li>
                          ))}
                        </ul>
                        <h3>{text.problemTemplateSuggestedSections}</h3>
                        <ul>
                          {selectedTemplate.suggestedSections.map((section) => (
                            <li key={section.en}>{section[locale]}</li>
                          ))}
                        </ul>
                      </>
                    );
                  })()}
                </>
              )}
              <FieldLabel
                htmlFor="problem-pattern"
                help={text.problemPatternNote}
                helpId="problem-pattern-note"
              >
                {text.problemPattern}
              </FieldLabel>
              <select
                id="problem-pattern"
                value={problemPatternVersionId}
                onChange={(event) => setProblemPatternVersionId(event.target.value)}
                aria-describedby="problem-pattern-note"
              >
                <option value="">{text.noProblemPattern}</option>
                {publishedProblemPatterns.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.definition.title} · v{pattern.version}
                  </option>
                ))}
              </select>
              {selectedProblemPattern && (
                <div className="notice">
                  <p>{selectedProblemPattern.definition.purpose}</p>
                  <ul>
                    {selectedProblemPattern.definition.stages.map((stage) => (
                      <li key={stage.key}>
                        {stage.title} · {stage.activity}
                      </li>
                    ))}
                  </ul>
                  <p>{text.problemPatternExecutionNote}</p>
                </div>
              )}
            </div>
          </>
        )}
        {step === CONTEXT_STEP && (
          <>
            <BusinessPicker
              locale={locale}
              workspaceId={workspaceId}
              value={business}
              onChange={setBusiness}
              required={businessRequired}
            />
            <TopicsSection
              locale={locale}
              workspaceId={workspaceId}
              values={values}
              onChange={setValues}
            />
            {values.topics.length === 0 && (
              <p className="notice" role="status">
                {text.noTopicsNote}
              </p>
            )}
            <div className="filter-grid">
              <FieldLabel
                htmlFor="analysis-profile"
                help={quickDraftMessages(locale).help}
                helpId="analysis-profile-help"
              >
                {quickDraftMessages(locale).profile}
              </FieldLabel>
              <select
                id="analysis-profile"
                value={values.analysisProfile ?? 'full'}
                aria-describedby="analysis-profile-help"
                onChange={(event) =>
                  setValues({ ...values, analysisProfile: event.target.value as 'full' | 'quick' })
                }
              >
                <option value="full">{quickDraftMessages(locale).full}</option>
                <option value="quick">{quickDraftMessages(locale).quick}</option>
              </select>
              {values.analysisProfile === 'quick' && (
                <p className="notice" role="status">
                  {quickDraftMessages(locale).warning}
                </p>
              )}
            </div>
          </>
        )}
        {step === ADVANCED_STEP && (
          <>
            {baselineFailed && (
              <div className="stack" role="alert">
                <p className="notice error">{text.baselineFailed}</p>
                <div className="toolbar">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setBaselineTry((value) => value + 1)}
                  >
                    {text.baselineRetry}
                  </button>
                </div>
              </div>
            )}
            <div className="stack">
              {ADVANCED_SECTIONS.map((section, index) => {
                const count = sectionCounts[index]!;
                return (
                  <div key={section.id} className="wizard-section-item">
                    <details
                      className="wizard-section"
                      open={Boolean(opened[section.id]) || problemSection === section.id}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setOpened((current) =>
                          Boolean(current[section.id]) === open
                            ? current
                            : { ...current, [section.id]: open },
                        );
                      }}
                    >
                      <summary>
                        <span className="wizard-section-title">
                          {text.sectionTitles[section.id]}
                        </span>
                        <span className={`badge ${count > 0 ? 'tone-ok' : 'tone-neutral'}`}>
                          {count > 0
                            ? fill(text.sectionChanged, { n: formatNumber(locale, count) })
                            : text.sectionDefault}
                        </span>
                      </summary>
                      <div className="stack wizard-section-body">
                        {section.id === 'model' && (
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
                        {settingsList(section.keys)}
                        {section.id === 'solutions' &&
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
                        {section.id === 'solutions' && customCriteria && (
                          <div>
                            <button
                              type="button"
                              className="link-like"
                              onClick={() => setCriteria(null)}
                            >
                              {text.criteriaReset}
                            </button>
                          </div>
                        )}
                        {section.id === 'documents' && values.analysisProfile === 'quick' && (
                          <p className="notice">{quickDraftMessages(locale).level}</p>
                        )}
                      </div>
                    </details>
                    <span className="wizard-section-tip">
                      <InfoTip text={text.sectionHelp[section.id]} />
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {step === REVIEW_STEP && (
          <Review
            locale={locale}
            definitions={definitions}
            review={review}
            failed={reviewFailed}
            overrides={choices.overrides.length}
            values={values}
            problemTemplate={selectedProblemTemplate}
            problemPattern={selectedProblemPattern}
            connectionId={connectionId}
            business={business}
            criteriaCount={
              customCriteria ? customCriteria.filter((item) => item.enabled).length : null
            }
            onEdit={setStep}
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
            {step === ADVANCED_STEP && totalChanged === 0 ? text.continueDefaults : text.next}
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={
              !basicsOk ||
              businessProblem ||
              choices.problem !== null ||
              criteriaProblem !== null ||
              action.busy
            }
            onClick={submit}
          >
            {action.busy ? text.creating : text.create}
          </button>
        )}
      </div>
    </fieldset>
  );
}

function Review({
  locale,
  definitions,
  review,
  failed,
  overrides,
  values,
  problemTemplate,
  problemPattern,
  connectionId,
  business,
  criteriaCount,
  onEdit,
}: {
  locale: Locale;
  definitions: Definition[];
  review: Effective | null;
  failed: boolean;
  overrides: number;
  values: ProjectValues;
  problemTemplate: (typeof candidateProblemTemplates)[number] | null;
  problemPattern: PublishedProblemPattern | null;
  connectionId: string;
  business: ContenterBusinessItem | null;
  criteriaCount: number | null;
  onEdit: (step: number) => void;
}) {
  const text = wizardMessages(locale);
  const businessText = businessMessages(locale);
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
          <dd dir={textDir(locale)}>{clip(values.title.trim())}</dd>
        </div>
        <div>
          <dt>{project.codeLabel}</dt>
          <dd dir="ltr">{clip(values.code.trim())}</dd>
        </div>
        {values.expectedOutput.trim() && (
          <div>
            <dt>{project.expectedOutputLabel}</dt>
            <dd dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
              {clip(values.expectedOutput.trim())}
            </dd>
          </div>
        )}
        <div>
          <dt>{text.problemTemplate}</dt>
          <dd>
            {clip(
              problemTemplate
                ? `${problemTemplate.name[locale]} · v${problemTemplate.version} · ${text.problemTemplateCandidate}`
                : text.noProblemTemplate,
            )}
          </dd>
        </div>
        <div>
          <dt>{text.problemPattern}</dt>
          <dd>
            {clip(
              problemPattern
                ? `${problemPattern.definition.title} · v${problemPattern.version}`
                : text.noProblemPattern,
            )}
          </dd>
        </div>
        <div>
          <dt>{project.outputLanguage}</dt>
          <dd>{project.languages[values.outputLanguage]}</dd>
        </div>
        <div>
          <dt>{quickDraftMessages(locale).profile}</dt>
          <dd>
            {values.analysisProfile === 'quick'
              ? quickDraftMessages(locale).quick
              : quickDraftMessages(locale).full}
          </dd>
        </div>
        <div>
          <dt>{project.topicsSection}</dt>
          <dd>{formatNumber(locale, values.topics.length)}</dd>
        </div>
        <div>
          <dt>{businessText.picker.title}</dt>
          <dd dir={textDir(locale)}>
            {clip(business ? business.name : businessText.picker.noneSelected)}
          </dd>
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
      <div className="toolbar">
        <button type="button" className="secondary-button" onClick={() => onEdit(PROBLEM_STEP)}>
          {text.reviewEditProblem}
        </button>
        <button type="button" className="secondary-button" onClick={() => onEdit(CONTEXT_STEP)}>
          {text.reviewEditContext}
        </button>
        <button type="button" className="secondary-button" onClick={() => onEdit(ADVANCED_STEP)}>
          {text.reviewEditAdvanced}
        </button>
      </div>
      <section className="card stack" aria-labelledby="wizard-roadmap-title">
        <h3 id="wizard-roadmap-title">{text.roadmapTitle}</h3>
        <p className="muted">{text.roadmapIntro}</p>
        <ol className="roadmap">
          {text.roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
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
                  <th scope="row" dir={textDir(locale)}>
                    {def.description[locale]} <code dir="ltr">{def.key}</code>
                  </th>
                  <td dir={textDir(locale)}>
                    {displayValue(locale, settings, def, review.values[def.key])}
                  </td>
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
