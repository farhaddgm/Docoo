'use client';

import { formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { journeyMessages } from './journey-messages';
import { projectJourney, type JourneyItem } from './project-journey';
import type { WorkflowFacts } from './project-health';
import type { ProjectDetail } from './project-types';

type Tab = 'problem' | 'workflow' | 'solutions' | 'documents';

/**
 * The project journey (ADR-0035): the steps from creating to completing a project, the one in
 * front of the person marked, with a button that takes them to where it is done. Activating and
 * completing run the project's own lifecycle buttons, so their confirmations stay as they are.
 */
export function JourneyCard({
  locale,
  project,
  facts,
  readOnly,
  onEditProblem,
  onOpenTab,
  onCommand,
}: {
  locale: Locale;
  project: ProjectDetail;
  facts: WorkflowFacts | null;
  readOnly: boolean;
  onEditProblem: () => void;
  onOpenTab: (tab: Tab) => void;
  onCommand: (command: string) => void;
}) {
  const text = journeyMessages(locale);
  const items = projectJourney(project, facts);

  function action(item: JourneyItem): { label: string; run: () => void } | null {
    if (readOnly) return null;
    if (item.block === 'paused' && project.availableCommands.includes('resume')) {
      return { label: text.actions.resume, run: () => onCommand('resume') };
    }
    switch (item.step) {
      case 'activate':
        if (item.state === 'blocked') {
          return { label: text.actions.editProblem, run: onEditProblem };
        }
        return item.state === 'current'
          ? { label: text.actions.activate, run: () => onCommand('activate') }
          : null;
      case 'analysis':
        return { label: text.actions.analysis, run: () => onOpenTab('problem') };
      case 'ideas':
        return item.state === 'waiting' || item.state === 'blocked'
          ? { label: text.actions.workflow, run: () => onOpenTab('workflow') }
          : { label: text.actions.solutions, run: () => onOpenTab('solutions') };
      case 'documents':
        return item.state === 'waiting' || item.state === 'blocked'
          ? { label: text.actions.workflow, run: () => onOpenTab('workflow') }
          : { label: text.actions.documents, run: () => onOpenTab('documents') };
      case 'complete':
        return item.state === 'current'
          ? { label: text.actions.complete, run: () => onCommand('complete') }
          : null;
      default:
        return null;
    }
  }

  return (
    <section className="card stack" aria-labelledby="journey-title">
      <h2 id="journey-title">{text.title}</h2>
      <p className="muted">{text.intro}</p>
      <ol className="journey" aria-label={text.stepsLabel}>
        {items.map((item, index) => {
          const open = item.state !== 'done' && item.state !== 'upcoming';
          const act = open ? action(item) : null;
          return (
            <li
              key={item.step}
              className={`journey-step journey-${item.state}`}
              aria-current={open ? 'step' : undefined}
            >
              <span className="journey-mark" aria-hidden="true">
                {item.state === 'done' ? '✓' : formatNumber(locale, index + 1)}
              </span>
              <div className="journey-body">
                <p className="journey-head">
                  <strong>{text.steps[item.step]}</strong>{' '}
                  <span className={`badge journey-badge-${item.state}`}>
                    {text.states[item.state]}
                  </span>
                </p>
                {open && <p className="muted">{text.descriptions[item.step]}</p>}
                {item.state === 'waiting' && (
                  <p>{fill(text.tasks, { n: formatNumber(locale, item.tasks) })}</p>
                )}
                {item.block && (
                  <p className="notice error" role="status">
                    {text.blocks[item.block]}
                  </p>
                )}
                {act && (
                  <p>
                    <button
                      type="button"
                      className={item.state === 'blocked' ? 'secondary-button' : 'primary-button'}
                      onClick={act.run}
                    >
                      {act.label}
                    </button>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
