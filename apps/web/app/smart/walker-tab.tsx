'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { smartApi, type ProjectOption, type WalkerProgress } from './api';
import { fill, smartMessagesFor, type StepText } from './messages';
import { defaultStepKey, neighbourKey, stepByKey, stepHref } from './walker';

const POLL_MS = 5_000;

interface WalkerTabProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly active: boolean;
  readonly projectId: string | null;
  readonly onProject: (id: string | null) => void;
  readonly onAsk: (prompt: string, stepKey: string) => void;
  readonly onStep: (stepKey: string | null) => void;
}

/** Guided path from an empty workspace to an approved document; completion is read from the server. */
export function WalkerTab({
  locale,
  workspaceId,
  active,
  projectId,
  onProject,
  onAsk,
  onStep,
}: WalkerTabProps) {
  const text = smartMessagesFor(locale);
  const [progress, setProgress] = useState<WalkerProgress | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [viewed, setViewed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    smartApi
      .projects(workspaceId, controller.signal)
      .then((body) => setProjects(body.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, workspaceId]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const next = (await smartApi.progress(workspaceId, projectId, signal)).progress;
        setProgress(next);
        setFailed(false);
      } catch (caught) {
        if (signal.aborted) return;
        if (caught instanceof ApiError && caught.code === 'SMART_PROJECT_NOT_FOUND') {
          onProject(null);
          return;
        }
        setFailed(true);
      }
    },
    [workspaceId, projectId, onProject],
  );

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, load]);

  const currentKey =
    viewed && progress && stepByKey(progress, viewed)
      ? viewed
      : progress
        ? defaultStepKey(progress)
        : null;
  const step = progress ? stepByKey(progress, currentKey) : null;
  const stepText: StepText | undefined = step ? text.walker.steps[step.key] : undefined;
  const title = stepText?.title ?? step?.key ?? '';

  useEffect(() => {
    onStep(currentKey);
  }, [currentKey, onStep]);

  const href = step ? stepHref(locale, step.key, progress?.projectId ?? null) : null;
  const blockedLabel =
    step?.blockedBy === 'project'
      ? text.walker.status.blockedProject
      : text.walker.status.blockedStep;

  return (
    <div className="smart-stack">
      <label className="smart-field">
        <span>{text.walker.project}</span>
        <select
          value={projectId ?? ''}
          onChange={(event) => {
            setViewed(null);
            onProject(event.target.value || null);
          }}
        >
          <option value="">{text.walker.noProject}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} — {project.title}
            </option>
          ))}
        </select>
      </label>

      {failed && <p className="notice error">{text.walker.loadFailed}</p>}

      {progress && (
        <>
          <div>
            <progress
              className="smart-progress"
              max={progress.total}
              value={progress.doneCount}
              aria-label={text.walker.progress}
            />
            <p className="muted">
              {fill(text.walker.progress, {
                done: formatNumber(locale, progress.doneCount),
                total: formatNumber(locale, progress.total),
              })}
            </p>
          </div>

          <ol className="smart-steps" aria-label={text.panel.tabs.walker}>
            {progress.steps.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={`smart-dot smart-dot-${item.status}`}
                  aria-current={item.key === currentKey ? 'step' : undefined}
                  aria-label={`${formatNumber(locale, item.order)}. ${text.walker.steps[item.key]?.title ?? item.key}`}
                  title={text.walker.steps[item.key]?.title ?? item.key}
                  onClick={() => setViewed(item.key)}
                >
                  {formatNumber(locale, item.order)}
                </button>
              </li>
            ))}
          </ol>

          {step && (
            <section className="smart-step" aria-live="polite">
              <p className="muted">
                {fill(text.walker.stepOf, {
                  n: formatNumber(locale, step.order),
                  total: formatNumber(locale, progress.total),
                })}
              </p>
              <h3>{title}</h3>
              <p>
                <span className={`badge smart-state-${step.status}`}>
                  {step.status === 'done'
                    ? text.walker.status.done
                    : step.status === 'ready'
                      ? text.walker.status.ready
                      : blockedLabel}
                </span>
                {step.counter && (
                  <span className="badge">
                    {fill(text.walker.counter, {
                      current: formatNumber(locale, step.counter.current),
                      total: formatNumber(locale, step.counter.total),
                    })}
                  </span>
                )}
              </p>
              {step.attention > 0 && (
                <p className="notice">
                  {fill(text.walker.attention, { n: formatNumber(locale, step.attention) })}
                </p>
              )}
              {stepText && (
                <>
                  <p>{stepText.summary}</p>
                  <h4>{text.walker.todoTitle}</h4>
                  <ul className="smart-todo">
                    {stepText.todo.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
              {!href && step?.blockedBy !== 'project' && (
                <p className="muted">{text.walker.noPage}</p>
              )}
              <div className="toolbar">
                {href && (
                  <Link className="primary-button link-button" href={href}>
                    {text.walker.goToPage}
                  </Link>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onAsk(fill(text.walker.askPrompt, { step: title }), step.key)}
                >
                  {text.walker.ask}
                </button>
              </div>
            </section>
          )}

          {progress.nextStep === null && <p className="notice ok">{text.walker.allDone}</p>}

          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setViewed(neighbourKey(progress, currentKey, -1))}
            >
              {text.walker.prev}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setViewed(neighbourKey(progress, currentKey, 1))}
            >
              {text.walker.next}
            </button>
            {progress.nextStep && progress.nextStep !== currentKey && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setViewed(progress.nextStep)}
              >
                {text.walker.goSuggested}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
