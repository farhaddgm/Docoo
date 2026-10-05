import { formatNumber, type Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { agentMessages, fill } from '../agents/agent-messages';

export interface RoleEvaluationView {
  role: string;
  status: 'completed' | 'skipped' | 'failed';
  reason: string | null;
  score: number | null;
  summary: string | null;
  charterSequence: number | null;
  samples: { ref: string; outputId: string; rejected: boolean }[];
  findings: {
    kind: 'strength' | 'deviation';
    severity: string;
    detail: string;
    recommendation: string | null;
    clauses: { ref: string; text: string }[];
    evidence: { type: string; id: string; ref: string }[];
  }[];
  discarded: number;
  errorCode: string | null;
}

export interface ModelEvaluationSummary {
  judgeSequence: number;
  completed: number;
  skipped: number;
  failed: number;
}

/**
 * The model-based evaluation of the roles in a Brain report (ADR-0017): one card per role with
 * the score, the verdict's findings and, for each finding, the charter clauses and the stage
 * outputs that prove it. A role that could not be judged says why.
 */
export function Evaluations({
  locale,
  evaluations,
  summary,
}: {
  locale: Locale;
  evaluations: RoleEvaluationView[];
  summary: ModelEvaluationSummary | null;
}) {
  const text = reportMessagesFor(locale).brain;
  const roles = agentMessages(locale).roles;
  return (
    <section aria-labelledby="evaluations-title" className="stack">
      <h3 id="evaluations-title">{text.evaluationsHeading}</h3>
      {evaluations.length === 0 ? (
        <p className="muted">{text.evaluationsNone}</p>
      ) : (
        <>
          <p className="muted">{text.evaluationsHelp}</p>
          {summary && (
            <p>
              {fill(text.evaluationsSummary, {
                sequence: formatNumber(locale, summary.judgeSequence),
                completed: formatNumber(locale, summary.completed),
                skipped: formatNumber(locale, summary.skipped),
                failed: formatNumber(locale, summary.failed),
              })}
            </p>
          )}
          <ul className="plain-list stack">
            {evaluations.map((evaluation) => {
              const name = (roles as Record<string, { name: string }>)[evaluation.role]?.name;
              return (
                <li key={evaluation.role} className="card stack">
                  <h4>
                    {name ?? evaluation.role}
                    <span
                      className={`badge tone-${
                        evaluation.status === 'completed'
                          ? 'ok'
                          : evaluation.status === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }`}
                    >
                      {text.evalStatuses[evaluation.status] ?? evaluation.status}
                    </span>
                  </h4>
                  {evaluation.status !== 'completed' && (
                    <p className="muted">
                      {(evaluation.reason && text.evalReasons[evaluation.reason]) ??
                        evaluation.reason}
                      {evaluation.errorCode && (
                        <>
                          {' '}
                          <code dir="ltr">{evaluation.errorCode}</code>
                        </>
                      )}
                    </p>
                  )}
                  {evaluation.score !== null && (
                    <p>
                      <strong>
                        {fill(text.scoreOf, { score: formatNumber(locale, evaluation.score) })}
                      </strong>
                      {evaluation.summary && <span dir="auto"> — {evaluation.summary}</span>}
                    </p>
                  )}
                  {evaluation.samples.length > 0 && (
                    <p className="muted">
                      {evaluation.charterSequence !== null &&
                        `${fill(text.evalCharter, {
                          n: formatNumber(locale, evaluation.charterSequence),
                        })} · `}
                      {fill(text.evalSamples, {
                        n: formatNumber(locale, evaluation.samples.length),
                        rejected: formatNumber(
                          locale,
                          evaluation.samples.filter((sample) => sample.rejected).length,
                        ),
                      })}
                    </p>
                  )}
                  {evaluation.status === 'completed' && (
                    <>
                      <h5>{text.findingsHeading}</h5>
                      {evaluation.findings.length === 0 ? (
                        <p className="muted">{text.noFindings}</p>
                      ) : (
                        <ul className="plain-list stack">
                          {evaluation.findings.map((finding, index) => (
                            <li key={index} className="stack">
                              <p dir="auto">
                                <span
                                  className={`badge ${
                                    finding.kind === 'deviation'
                                      ? `severity-${finding.severity}`
                                      : 'tone-ok'
                                  }`}
                                >
                                  {text.findingKinds[finding.kind] ?? finding.kind}
                                </span>{' '}
                                {finding.detail}
                              </p>
                              <ul className="plain-list">
                                {finding.clauses.map((clause) => (
                                  <li key={clause.ref} dir="auto">
                                    <small>
                                      <strong>
                                        {text.findingClauses} <span dir="ltr">{clause.ref}</span>
                                      </strong>
                                      : {clause.text}
                                    </small>
                                  </li>
                                ))}
                              </ul>
                              <p className="muted" dir="ltr">
                                {text.findingEvidence}:{' '}
                                {finding.evidence.map((item, evidenceIndex) => (
                                  <span key={item.id}>
                                    {evidenceIndex > 0 && ', '}
                                    {item.ref} <code>{item.id.slice(0, 8)}</code>
                                  </span>
                                ))}
                              </p>
                              {finding.recommendation && (
                                <p dir="auto">
                                  <strong>{text.findingRecommendation}:</strong>{' '}
                                  {finding.recommendation}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {evaluation.discarded > 0 && (
                        <p className="muted">
                          {fill(text.discardedFindings, {
                            n: formatNumber(locale, evaluation.discarded),
                          })}
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
