import { formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { healthMessages } from './health-messages';
import { PROJECT_STAGES, type Health, type HealthReason, type Milestone } from './project-health';
import { workflowMessages } from './workflow-messages';

/** The badge class that carries the level's colour; the words carry its meaning. */
const levelClass: Record<string, string> = {
  ok: 'state-active',
  waiting: 'state-paused',
  blocked: 'state-failed',
  done: 'state-completed',
  idle: 'state-pending',
};

export function HealthBadge({ locale, health }: { locale: Locale; health: Health }) {
  const text = healthMessages(locale);
  return (
    <span className={`badge ${levelClass[health.level] ?? ''}`}>
      {text.levels[health.level] ?? health.level}
    </span>
  );
}

function reasonText(locale: Locale, reason: HealthReason): string {
  const text = healthMessages(locale);
  const flow = workflowMessages(locale);
  switch (reason.code) {
    case 'paused':
      return reason.detail
        ? fill(text.reasons.pausedWith, { detail: reason.detail })
        : text.reasons.paused;
    case 'stage_failed':
      return fill(text.reasons.stage_failed, { stage: flow.stages[reason.stage] ?? reason.stage });
    case 'task': {
      const kind = flow.taskKinds[reason.kind] ?? reason.kind;
      return reason.count > 1
        ? fill(text.reasons.taskCount, { kind, count: formatNumber(locale, reason.count) })
        : fill(text.reasons.task, { kind });
    }
    default:
      return text.reasons[reason.code];
  }
}

/** Why the project is not simply on track; empty when nothing needs saying. */
export function HealthReasons({
  locale,
  health,
  onOpenWorkflow,
}: {
  locale: Locale;
  health: Health;
  onOpenWorkflow: () => void;
}) {
  const text = healthMessages(locale);
  if (health.reasons.length === 0) return null;
  return (
    <div className={`notice ${health.level === 'blocked' ? 'error' : 'warn'}`} role="status">
      <ul className="plain-list" aria-label={text.label}>
        {health.reasons.map((reason, index) => (
          <li key={index} dir="auto">
            {reasonText(locale, reason)}
          </li>
        ))}
      </ul>
      <button className="secondary-button" type="button" onClick={onOpenWorkflow}>
        {text.openWorkflow}
      </button>
    </div>
  );
}

/** How many of the five stages are complete, with every stage's own status written out. */
export function MilestoneCard({
  locale,
  milestone,
  stages,
}: {
  locale: Locale;
  milestone: Milestone;
  stages: { stage: string; status: string }[];
}) {
  const text = healthMessages(locale);
  const flow = workflowMessages(locale);
  const stageName = (stage: string) => flow.stages[stage] ?? stage;
  return (
    <section className="card stack" aria-labelledby="milestone-title">
      <h2 id="milestone-title">{text.milestone}</h2>
      <p>
        {milestone.completed === milestone.total
          ? text.milestoneAll
          : milestone.completed === 0
            ? text.milestoneNone
            : fill(text.milestoneSummary, {
                completed: formatNumber(locale, milestone.completed),
                total: formatNumber(locale, milestone.total),
              })}{' '}
        {milestone.current && fill(text.milestoneCurrent, { stage: stageName(milestone.current) })}
      </p>
      <progress
        className="progress-meter"
        max={milestone.total}
        value={milestone.completed}
        aria-label={text.milestoneProgress}
      />
      <ol className="stage-list" aria-label={text.stagesTitle}>
        {PROJECT_STAGES.map((stage) => {
          const status = stages.find((item) => item.stage === stage)?.status ?? 'pending';
          return (
            <li key={stage}>
              <span className="stage-name">{stageName(stage)}</span>{' '}
              <span className={`badge state-${status}`}>
                {flow.stageStatuses[status] ?? status}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
