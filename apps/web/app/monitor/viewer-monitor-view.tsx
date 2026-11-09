import type { ViewerMonitorView } from '@docoo/contracts';
import { Fragment } from 'react';

import type { Locale } from '../i18n';
import { monitorMessages } from './messages';
import { fill, formatClock, formatCount, formatDollars, providerName } from './voice-format';

const word = (table: Readonly<Record<string, string>>, key: string): string => table[key] ?? key;

/**
 * The viewer monitor for a room screen (ADR-0056 §7). It draws only what the view holds: a part the
 * settings hid arrives as `null` and is not drawn, so this file never decides what may be shown.
 */
export function ViewerMonitorView({
  view,
  locale,
  lost = false,
}: {
  readonly view: ViewerMonitorView;
  readonly locale: Locale;
  readonly lost?: boolean;
}) {
  const text = monitorMessages(locale).viewer;
  if (view.project === null) {
    return (
      <div className="viewer-empty">
        <p>{text.noProject}</p>
        <p className="monitor-dim">{text.noProjectHint}</p>
      </div>
    );
  }
  const project = view.project;
  return (
    <div className="viewer-monitor">
      <header className="viewer-head">
        <h2 dir="auto">
          {project.name ?? project.code ?? ''}
          {project.name !== null && project.code !== null && (
            <small className="viewer-code"> {project.code}</small>
          )}
        </h2>
        <span className="viewer-status">{word(text.projectStatus, project.status)}</span>
      </header>
      {lost && <p className="voice-lost">{text.lost}</p>}

      <section aria-label={text.stagesTitle}>
        <h3 className="viewer-title">{text.stagesTitle}</h3>
        <ol className="viewer-stages">
          {view.stages.map((stage) => (
            <li
              key={stage.stage}
              className={`viewer-stage viewer-stage-${stage.status}${stage.current ? ' viewer-stage-current' : ''}`}
            >
              <div className="viewer-stage-head">
                <strong>{word(text.stages, stage.stage)}</strong>
                <span className="viewer-badge">{word(text.status, stage.status)}</span>
                {stage.current && <span className="viewer-now">{text.currentStage}</span>}
                {stage.attempts !== null && (
                  <small>{fill(text.attempts, { n: formatCount(locale, stage.attempts) })}</small>
                )}
                {stage.startedAt !== null && <small>{formatClock(locale, stage.startedAt)}</small>}
                {stage.completedAt !== null && (
                  <small>→ {formatClock(locale, stage.completedAt)}</small>
                )}
              </div>
              {stage.output !== null && (
                <div className="viewer-output">
                  {stage.output.title !== null && (
                    <p className="viewer-output-title" dir="auto">
                      {stage.output.title}
                    </p>
                  )}
                  {stage.output.text !== null && (
                    <p className="viewer-output-text" dir="auto">
                      {stage.output.text}
                    </p>
                  )}
                </div>
              )}
              {stage.error !== null && (
                <p className="viewer-error" dir="auto">
                  {stage.error.message ?? text.errorGeneric}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <div className="viewer-side">
        {view.gates !== null && view.gates.length > 0 && (
          <section className="voice-panel" aria-label={text.gatesTitle}>
            <h3>{text.gatesTitle}</h3>
            <ul className="viewer-list">
              {view.gates.map((gate, index) => (
                <li key={index} dir="auto">
                  {gate.title}
                </li>
              ))}
            </ul>
          </section>
        )}
        {view.documents !== null && view.documents.length > 0 && (
          <section className="voice-panel" aria-label={text.documentsTitle}>
            <h3>{text.documentsTitle}</h3>
            <ul className="viewer-list">
              {view.documents.map((document, index) => (
                <li key={index}>
                  <strong dir="auto">{document.title}</strong>
                  {document.preview !== null && (
                    <p className="viewer-output-text" dir="auto">
                      {document.preview}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {view.agents !== null && view.agents.length > 0 && (
          <section className="voice-panel" aria-label={text.agentsTitle}>
            <h3>{text.agentsTitle}</h3>
            <ul className="viewer-list">
              {view.agents.map((agent) => (
                <li key={agent.role}>
                  <strong>{word(text.roles, agent.role)}</strong>{' '}
                  <small>{fill(text.agentCalls, { n: formatCount(locale, agent.calls) })}</small>
                  {agent.last !== null && (
                    <small dir="auto"> · {fill(text.agentLast, { tool: agent.last.tool })}</small>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {view.assistant !== null && (
          <section className="voice-panel" aria-label={text.assistantTitle}>
            <h3>{text.assistantTitle}</h3>
            <p className="viewer-assistant-state">
              {view.assistant.live ? text.assistantLive : text.assistantIdle}
            </p>
            {view.assistant.steps !== null && (
              <ul className="voice-cards">
                {view.assistant.steps.map((step, index) => (
                  <li key={index} className={`voice-card voice-card-${step.status}`}>
                    <span className="voice-card-status">{word(text.cardStatus, step.status)}</span>
                    <span dir="auto">{step.summary}</span>
                    {step.target !== null && <small dir="auto">{step.target}</small>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {view.usage !== null && (
          <section className="voice-panel" aria-label={text.usageTitle}>
            <h3>{text.usageTitle}</h3>
            <dl className="viewer-usage">
              {view.usage.tokensTotal !== null && (
                <>
                  <dt>{text.tokens}</dt>
                  <dd>{formatCount(locale, view.usage.tokensTotal)}</dd>
                </>
              )}
              {view.usage.costUsd !== null && (
                <>
                  <dt>{text.cost}</dt>
                  <dd>{formatDollars(locale, view.usage.costUsd)}</dd>
                </>
              )}
              {view.usage.models.map((model, index) => (
                <Fragment key={index}>
                  <dt>
                    {providerName(model.provider)}
                    {model.model !== null && <span dir="ltr"> {model.model}</span>}
                  </dt>
                  <dd>
                    {formatCount(locale, model.tokens)}
                    {model.input !== null && model.output !== null && (
                      <small>
                        {' '}
                        ({text.input} {formatCount(locale, model.input)} · {text.output}{' '}
                        {formatCount(locale, model.output)})
                      </small>
                    )}
                    {view.usage?.costByModel && view.usage.costByModel[index] !== undefined && (
                      <small> · {formatDollars(locale, view.usage.costByModel[index] ?? 0)}</small>
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
